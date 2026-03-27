# Contexto Fixo — Sessao Ollama Agent

## Projeto
- Path: /Users/dev1recam/Documents/tools/harnss
- Branch atual de trabalho: fix/gemini-ollama-session-start
- Engine Ollama: electron/src/ipc/ollama-sessions.ts

## Estado Real do Engine Ollama (verificado em 2026-03-27)

### JA IMPLEMENTADO (nao reimplementar)
- model passado pela UI ja e usado no ollama:start (linha 530)
- 7 tools funcionando via XML tags: read_file, write_file, edit_file, delete_file, list_files, search_files, run_shell
- MAX_TOOL_LOOPS = 6, MAX_TOOL_OPS = 12
- stripCodeFencedToolTags() para recuperar tags em code fences

### AINDA PENDENTE (proximas fases)
- Fase 2: Tornar o loop mais robusto para modelos 4B (prompt menor, menos contexto por turn)
- Fase 3: RAG persistente (rag.index + rag.search via SQLite/Chroma)
- Fase 4: Web search (DuckDuckGo como tool web.search)
- Fase 5: Guardrails para 4B — limite de contexto, passos curtos, retry automatico

## Fluxo de Integracao Correto

1. Usuario envia mensagem
2. Modelo decide quais XML tools emitir (sem narrar, so agir)
3. executeToolTags() parseia e executa as tools
4. Resultados voltam como mensagem "user" com Tool results
5. Loop ate sem tools (resposta final) ou MAX_TOOL_LOOPS

## Regras para Implementacao
- Nao reimplementar o que ja existe
- Commits pequenos e logicos (feat/fix/chore)
- Testar sempre com modelo local antes de PR
- Nao quebrar outros engines (Claude/ACP/Codex/Gemini)

## Como Usar Este Arquivo
No inicio de cada sessao nova: "Leia PROMPT_SESSAO.md e siga exatamente"
