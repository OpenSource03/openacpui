/**
 * Voice dictation hook — supports two modes:
 *
 * 1. "native" (default): Triggers OS-level dictation.
 *    - macOS: Cocoa `startDictation:` selector — OS handles everything.
 *    - Windows/Linux: Not available, shows keyboard shortcut hint.
 *
 * 2. "whisper": Local AI speech recognition via @huggingface/transformers.
 *    - Captures mic audio with MediaRecorder, transcribes with Whisper tiny.en.
 *    - ~40MB model download on first use (cached in IndexedDB).
 */

import { useState, useRef, useCallback, useEffect } from "react";
import type { VoiceDictationMode } from "@/types/ui";
import { captureException } from "@/lib/analytics";

// ── Types ──

interface UseSpeechRecognitionOptions {
  /** Called with transcribed text (Whisper mode only — native inserts directly) */
  onResult?: (text: string) => void;
  /** Called when an error occurs */
  onError?: (error: string) => void;
}

interface UseSpeechRecognitionReturn {
  /** Currently recording audio (Whisper) or dictation was triggered (native) */
  isListening: boolean;
  /** Whisper is processing recorded audio */
  isTranscribing: boolean;
  /** Whisper model is downloading/loading */
  isModelLoading: boolean;
  /** Model download progress (0-100) */
  loadProgress: number;
  /** Whether voice dictation is available on this platform + mode */
  isAvailable: boolean;
  /** Hint text for platforms without native dictation support */
  nativeHint: string | null;
  /** Current dictation mode from settings */
  mode: VoiceDictationMode;
  /** Start/stop dictation */
  toggle: () => Promise<void>;
  /** Error message, if any */
  error: string | null;
}

// ── Module-level Whisper pipeline cache (persists across re-mounts) ──

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Transformers.js pipeline type is complex and version-dependent
let whisperPipeline: any = null;
let whisperLoadingPromise: Promise<void> | null = null;

// ── Audio helpers ──

/** Convert an audio Blob (webm/ogg) to Float32 PCM at 16kHz for Whisper */
async function blobToFloat32Audio(blob: Blob): Promise<Float32Array> {
  const arrayBuffer = await blob.arrayBuffer();
  const audioCtx = new AudioContext({ sampleRate: 16000 });
  const decoded = await audioCtx.decodeAudioData(arrayBuffer);
  // Take the first channel (mono)
  const float32 = decoded.getChannelData(0);
  await audioCtx.close();
  return float32;
}

// ── Hook ──

export function useSpeechRecognition({
  onResult,
  onError,
}: UseSpeechRecognitionOptions = {}): UseSpeechRecognitionReturn {
  const [isListening, setIsListening] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isModelLoading, setIsModelLoading] = useState(false);
  const [loadProgress, setLoadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Platform + settings state (resolved on mount)
  const [platform, setPlatform] = useState<string | null>(null);
  const [mode, setMode] = useState<VoiceDictationMode>("native");

  // Refs for Whisper recording state (avoid stale closures)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  // Stable callback refs
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  // Load platform + settings on mount
  useEffect(() => {
    window.claude.speech.getPlatform().then(setPlatform);
    window.claude.settings.get().then((settings) => {
      if (settings.voiceDictation) setMode(settings.voiceDictation);
    });
  }, []);

  // Compute availability
  const isNativeAvailable = platform === "darwin" && mode === "native";
  const isWhisperMode = mode === "whisper";
  const isAvailable = isNativeAvailable || isWhisperMode;

  const nativeHint =
    mode === "native" && !isNativeAvailable
      ? platform === "win32"
        ? "Press Win + H for voice typing, or enable Whisper in Settings"
        : "Native dictation unavailable — enable Whisper in Settings"
      : null;

  // ── Whisper pipeline loader ──

  const ensureWhisperPipeline = useCallback(async () => {
    if (whisperPipeline) return;
    if (whisperLoadingPromise) {
      await whisperLoadingPromise;
      return;
    }

    setIsModelLoading(true);
    setLoadProgress(0);

    whisperLoadingPromise = (async () => {
      try {
        const { pipeline } = await import("@huggingface/transformers");
        whisperPipeline = await pipeline(
          "automatic-speech-recognition",
          "onnx-community/whisper-tiny.en",
          {
            dtype: "q8",
            device: "wasm",
            progress_callback: (progress: { status: string; progress?: number }) => {
              if (progress.status === "progress" && progress.progress != null) {
                setLoadProgress(progress.progress);
              }
            },
          },
        );
      } catch (err) {
        whisperLoadingPromise = null;
        const msg = err instanceof Error ? err.message : "Failed to load speech model";
        captureException(err instanceof Error ? err : new Error(msg), { label: "WHISPER_LOAD_ERR" });
        setError(msg);
        onErrorRef.current?.(msg);
        throw err;
      } finally {
        setIsModelLoading(false);
      }
    })();

    await whisperLoadingPromise;
  }, []);

  // ── Whisper: start recording ──

  const startWhisperRecording = useCallback(async () => {
    setError(null);

    // Request mic permission via Electron (macOS system dialog)
    const { granted } = await window.claude.speech.requestMicPermission();
    if (!granted) {
      const msg = "Microphone access denied";
      setError(msg);
      onErrorRef.current?.(msg);
      return;
    }

    // Start loading the model in parallel with mic access
    const modelPromise = ensureWhisperPipeline();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Wait for model if it's still loading
      await modelPromise;

      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        // Clean up stream tracks
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;

        const chunks = audioChunksRef.current;
        if (chunks.length === 0) return;

        setIsTranscribing(true);
        try {
          const blob = new Blob(chunks, { type: recorder.mimeType });
          const audioData = await blobToFloat32Audio(blob);
          // Run Whisper inference
          const result = await whisperPipeline(audioData);
          const text = (result?.text ?? "").trim();
          if (text) {
            onResultRef.current?.(text);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Transcription failed";
          captureException(err instanceof Error ? err : new Error(msg), { label: "WHISPER_TRANSCRIBE_ERR" });
          setError(msg);
          onErrorRef.current?.(msg);
        } finally {
          setIsTranscribing(false);
        }
      };

      recorder.start();
      setIsListening(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to access microphone";
      captureException(err instanceof Error ? err : new Error(msg), { label: "WHISPER_MIC_ERR" });
      setError(msg);
      onErrorRef.current?.(msg);
    }
  }, [ensureWhisperPipeline]);

  // ── Whisper: stop recording ──

  const stopWhisperRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    }
    setIsListening(false);
  }, []);

  // ── Native dictation trigger ──

  const triggerNativeDictation = useCallback(async () => {
    setError(null);
    const result = await window.claude.speech.startNativeDictation();
    if (!result.ok) {
      const msg = "Native dictation not available on this platform";
      setError(msg);
      onErrorRef.current?.(msg);
    }
    // Native dictation: macOS handles everything, no isListening state to manage
    // We briefly flash the state for visual feedback
    setIsListening(true);
    setTimeout(() => setIsListening(false), 500);
  }, []);

  // ── Toggle ──

  const toggle = useCallback(async () => {
    if (isWhisperMode) {
      if (isListening) {
        stopWhisperRecording();
      } else {
        await startWhisperRecording();
      }
    } else {
      await triggerNativeDictation();
    }
  }, [isWhisperMode, isListening, stopWhisperRecording, startWhisperRecording, triggerNativeDictation]);

  // ── Cleanup on unmount ──

  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current?.state === "recording") {
        mediaRecorderRef.current.stop();
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return {
    isListening,
    isTranscribing,
    isModelLoading,
    loadProgress,
    isAvailable,
    nativeHint,
    mode,
    toggle,
    error,
  };
}
