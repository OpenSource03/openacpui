import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";

interface ChatUiStateContextValue {
  getValue: <T>(key: string) => T | undefined;
  hasValue: (key: string) => boolean;
  setValue: <T>(key: string, value: T) => void;
}

const ChatUiStateContext = createContext<ChatUiStateContextValue | null>(null);
const ChatScrollStateContext = createContext(false);

function resolveInitialValue<T>(initialValue: T | (() => T)): T {
  return typeof initialValue === "function"
    ? (initialValue as () => T)()
    : initialValue;
}

export function ChatUiStateProvider({
  children,
  isScrolling = false,
}: {
  children: ReactNode;
  isScrolling?: boolean;
}) {
  const stateRef = useRef(new Map<string, unknown>());

  const value = useMemo<ChatUiStateContextValue>(() => ({
    getValue: <T,>(key: string) => stateRef.current.get(key) as T | undefined,
    hasValue: (key: string) => stateRef.current.has(key),
    setValue: <T,>(key: string, value: T) => {
      stateRef.current.set(key, value);
    },
  }), []);

  return (
    <ChatUiStateContext.Provider value={value}>
      <ChatScrollStateContext.Provider value={isScrolling}>
        {children}
      </ChatScrollStateContext.Provider>
    </ChatUiStateContext.Provider>
  );
}

export function useChatIsScrolling(): boolean {
  return useContext(ChatScrollStateContext);
}

export function useChatPersistedState<T>(
  key: string,
  initialValue: T | (() => T),
): [T, Dispatch<SetStateAction<T>>, boolean] {
  const store = useContext(ChatUiStateContext);
  const [value, setValue] = useState<T>(() => {
    if (store?.hasValue(key)) {
      const stored = store.getValue<T>(key);
      if (stored !== undefined) return stored;
    }
    return resolveInitialValue(initialValue);
  });
  const lastKeyRef = useRef(key);
  const hasStoredValue = store?.hasValue(key) ?? false;

  useEffect(() => {
    if (lastKeyRef.current === key) return;
    lastKeyRef.current = key;
    if (store?.hasValue(key)) {
      const stored = store.getValue<T>(key);
      if (stored !== undefined) {
        setValue(stored);
        return;
      }
    }
    setValue(resolveInitialValue(initialValue));
  }, [initialValue, key, store]);

  const setPersistedValue = useCallback<Dispatch<SetStateAction<T>>>((nextValue) => {
    setValue((previousValue) => {
      const resolvedValue = typeof nextValue === "function"
        ? (nextValue as (prevState: T) => T)(previousValue)
        : nextValue;
      store?.setValue(key, resolvedValue);
      return resolvedValue;
    });
  }, [key, store]);

  return [value, setPersistedValue, hasStoredValue];
}
