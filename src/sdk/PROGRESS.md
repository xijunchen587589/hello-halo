# Agent-Core SDK — Development Progress

Drop-in replacement for `@anthropic-ai/claude-agent-sdk`.
In-process execution, OpenAI-compat providers, Worker Thread multi-agent isolation.

## Status: Active Development

Branch: `feature/sdk`

---

## Completed (Run 1–13)

### Run 1 — Foundation
- Created `index.ts` public API surface (query, createSession, tool, createSdkMcpServer, etc.)
- Fixed 4 critical bugs: missing export, wrong type signatures, import cycles, AbortError handling

### Run 2 — Consumer Compatibility (P0)
- Implemented `tool()` factory function
- Implemented `createSdkMcpServer()` with in-process MCP tool registration
- Consumer (hello-halo) can bridge its tools with zero subprocess overhead

### Run 3 — External MCP Transport
- Implemented stdio, SSE, and streamable-http MCP transports
- MCP protocol version 2024-11-05: initialize → notifications/initialized → tools/list → tools/call
- Bridge external MCP servers to the tool registry

### Run 4 — Orchestrator + TodoWrite Fix
- Implemented foreground and background sub-agent spawning
- Fixed TodoWrite schema ({content, status, activeForm} not old {id, content, status})
- Orchestrator uses DI: setSpawner/setMessageRouter accept null for reset

### Run 5 — Hook System + Compact Fix
- PreToolUse/PostToolUse/PostToolUseFailure hooks in query-loop
- Fixed microCompact to handle array-typed ToolResultBlock.content

### Run 6 — SDKMessage Wire Format + V2 Session Control
- SDKMessage fields are snake_case (CC-compatible wire format)
- uuid on all SDKMessage variants
- Session control: interrupt/setModel/setMaxThinkingTokens/setPermissionMode

### Run 7 — Effort Level Mapping + Init Message Enrichment
- Effort: Low→disabled+temp0, Medium→5k, High→10k, Max→20k thinking budget
- OpenAI reasoning_effort: Low→"low", Medium→"medium", High/Max→"high"
- Init message: mcp_servers/slash_commands/skills/agents fields populated
- Fixed slash_commands from {name,description}[] to string[]

### Run 8 — MCP Connection Manager
- McpConnectionManager with exponential backoff reconnection (1s→2s→4s…60s cap)
- Health monitoring with per-server status tracking
- Tool-call-level single retry on transport death
- Circular dep fix: transport factory deduped into connection-manager.ts

### Run 9 — Consumer-Compatible Session Internals + SDKMessage Fixes
- Exposed session.pid, session.query.transport, session.query.supportedCommands(), session.abortController
- compact_boundary includes compact_metadata: {trigger, pre_tokens}
- tool_progress includes session_id
- All SDKMessage variants have uuid field
- CC SDK result subtypes: success/error_during_execution/error_max_turns/error_max_budget_usd

### Run 10 — Session Lifecycle Hooks + Compact Lifecycle Hooks
- **SessionStart hook**: fires after createSession() completes, fire-and-forget
- **SessionEnd hook**: fires before session.close() cleanup, fire-and-forget with fresh AbortController
- **UserPromptSubmit hook**: fires on send(), additionalContext injected into user message
- **PreCompact hook**: fires before auto-compact LLM call with context_length
- **PostCompact hook**: fires after successful compact with summary + tokens_freed
- Consolidated duplicate `shouldTriggerAutoCompact` → use `shouldAutoCompact` from compact.ts (removes `contextWindowForModel` import from query-loop.ts)
- tsc --noEmit passes

### Run 11 — Qwen Think Streaming + resumeSession + Anthropic listModels
- **ThinkTagParser**: stateful `<think>` tag parser in `model-quirks.ts`
  - Correctly handles `<think>` content spread across multiple SSE chunks
  - `ThinkTagParser.process(text, index)` returns `reasoning_delta` + `text_delta` events
  - Replaces naive stateless regex in `openai-compat.ts` streaming path
  - Qwen model detection via `isQwenThinkModel()` — parser only instantiated for Qwen
- **`unstable_v2_resumeSession(sessionId, options)`**: exported from `index.ts`
  - Creates a fresh session with the supplied `sessionId` (CC SDK API compat)
  - Consumer's session-manager can call it for session restore flow
- **Anthropic `listModels()` real API call**:
  - `GET /v1/models?limit=100` using the same auth headers
  - Graceful fallback to hardcoded list on API error / no key
  - Model `display_name` used for human-readable name
- tsc --noEmit passes

### Run 12 — Sub-Agent Message Forwarding + Task Lifecycle Events
- **`ToolContext.toolUseId` + `ToolContext.onSubAgentMessage`** (new fields in `types/tool.ts`):
  - `toolUseId?: string` — the parent Agent tool_use_id passed into each tool invocation
  - `onSubAgentMessage?: (msg: Record<string, unknown>) => void` — callback for streaming child messages
  - Uses `Record<string,unknown>` to avoid circular import between `types/tool.ts` and `core/query-loop.ts`
- **Query loop sub-agent message forwarding** (`core/query-loop.ts`):
  - Creates per-tool-call ToolContext extending the shared context with `toolUseId` and `onSubAgentMessage`
  - Buffers messages from AgentTool execution in a per-call `subAgentMsgs[]`
  - After all tool calls complete, yields buffered sub-agent messages in tool-call order before the tool result
  - Only foreground agents (not background) have their messages forwarded (background returns immediately)
- **Spawner task lifecycle events** (`orchestrator/spawner.ts`):
  - `runSubAgent()` now accepts `parentToolUseId`, `onMessage`, `parentSessionId` parameters
  - Emits `system/task_started` before the sub-agent loop starts (with `tool_use_id` for consumer routing)
  - Forwards each `assistant`/`user` sub-agent message to parent stream with `parent_tool_use_id` tagged
  - Tracks `toolUseCount` and `lastToolName` from assistant message content blocks
  - Emits `system/task_progress` after each completed turn (when `user` tool-result message arrives)
  - Emits `system/task_notification` at completion (status: completed/stopped, with usage + summary)
- Consumer compatibility: stream-processor.ts `handleTaskStarted/Progress/Notification` + sub-agent timeline now work with our SDK
- tsc --noEmit passes

### Run 13 — Retry Dedup + GlobTool Hidden Directory Fix
- **`utils/retry.ts`** — new shared retry utility module:
  - `RetryConfig` interface + `DEFAULT_RETRY` constant (5 retries, 1 s → 60 s exponential backoff)
  - `delayForAttempt(config, attempt)` — exponential backoff with ±10 % jitter
  - `isRetryableStatus(status)` — 429, 529 (Anthropic overload), 5xx
  - `parseRetryAfterMs(headers)` — parses both delta-seconds and HTTP-date `Retry-After` forms
  - `sleep(ms, signal?)` — abort-aware sleep utility
- **`llm/anthropic.ts`** — imports from `utils/retry.ts`, removed duplicate local definitions
  - Upgraded `Retry-After` handling to use `parseRetryAfterMs` (supports HTTP-date form, not just integers)
- **`llm/openai-compat.ts`** — imports from `utils/retry.ts`, removed 26-line duplicate block
  - Added `Retry-After` header handling in both `createMessage` and `createMessageStream` retry loops
  - `isRetryableStatus` now includes 529 (was missing in openai-compat, now consistent via shared fn)
- **`tools/glob/index.ts`** — hidden directory traversal fixed:
  - Removed blanket `entry.name.startsWith('.')` skip — patterns like `.claude/**`, `.halo/**`, `.github/**` now work
  - Expanded `SKIP_DIRS` with `.npm`, `.yarn`, `.cache`, `.cargo`, `.gradle` for cache hygiene
- tsc --noEmit passes

### Run 14 — Transcript Persistence (Resume Session Support)
- **`core/transcript.ts`** — new module for CC-compatible JSONL transcript read/write:
  - `getTranscriptPath(sessionId, cwd)` — computes file path using same rule as CC CLI
    (`CLAUDE_CONFIG_DIR/projects/<project-dir>/<session-id>.jsonl`, where `<project-dir>` replaces non-alphanumeric chars with `-`)
  - `appendToTranscript(path, entry)` — async append to JSONL, auto-creates directories
  - `TranscriptWriter` — stateful writer that tracks `parentUuid` chain across messages
    - `writeUserMessage(message)` + `writeAssistantMessage(message)` → async append, returns uuid
  - `readTranscriptMessages(sessionId, cwd)` — reads JSONL and reconstructs `Message[]` for resume
    (skips non-message entries like `queue-operation`; returns null if file not found)
  - `transcriptExists(sessionId, cwd)` — sync file existence check
- **`core/session.ts`** — integrated transcript persistence:
  - `createSession()` reads transcript on `options.resume` via `readTranscriptMessages()`
    — populates `state.messages` with history before first send (full context restore)
  - `TranscriptWriter` created for every session (writes to `$CLAUDE_CONFIG_DIR/projects/...`)
  - `stream()` writes user message + each assistant/tool-result message as they flow
  - `SessionState.initEmitted` flag replaces fragile `messages.length === 1` heuristic
    — init event now correctly emitted once per consumer attach, including after resume
- **`index.ts`** — `unstable_v2_resumeSession()` now passes `resume: sessionId` so transcript is loaded
- tsc --noEmit passes

### Run 15 — AbortSignal propagation + retry system hardening

**Bug fixes (correctness):**
- **`core/query-loop.ts`** — AbortSignal was never forwarded to LLM providers:
  - `provider.createMessageStream()` call now always passes `signal: config.abortSignal` in `providerOptions`
  - Providers can now cancel their in-flight HTTP requests immediately on abort (saves tokens + latency)
- **`llm/anthropic.ts`** — abort-aware retry sleeps:
  - Extracted `abortSignal` from `request.providerOptions?.signal` before retry loop (no more repeated casts)
  - Replaced `new Promise(setTimeout)` with `sleep(delay, abortSignal)` — aborts during backoff are now immediate
  - Re-throw AbortError in fetch catch block — abort no longer causes a useless retry cycle
- **`llm/openai-compat.ts`** — same abort-awareness improvements in both `createMessage` and `createMessageStream`

**Retry system improvements (`core/query-loop.ts`):**
- Removed duplicate local `sleep` function — now imports from `utils/retry.ts`
- Increased query-loop max retries from 2 to `DEFAULT_RETRY.maxRetries` (5)
- Replaced fixed backoff (1–3 s) with `delayForAttempt()` exponential backoff (1 s → 60 s, ±10 % jitter)
- Emits `system/api_retry` SDKMessage before each retry — consumer can display retry progress in UI
- Abort-aware retry sleep in query-loop (matches provider behaviour)

**Agent types (`tools/agent/agent-types.ts`):**
- Added `fork` built-in agent type — inherits all parent tools, used for parallel sub-tasks (per CC spec)

- tsc --noEmit passes

### Run 16 — Bug Fixes: reasoning_delta accumulation + slashCommands/skills propagation + duration_api_ms

**Bug fix: reasoning_delta not accumulated (`core/query-loop.ts`)**
- Qwen/DeepSeek models emit `reasoning_delta` events (via `ThinkTagParser`); there was no case for them in `accumulateAndStream`'s accumulation switch — thinking content was silently dropped from the conversation history (it streamed to the consumer but was never stored)
- Added `case 'reasoning_delta'` that pushes `event.reasoning` directly to `thinkingChunks` (no index check needed since these events have no `content_block_start` predecessor)
- Final `ThinkingBlock` is now correctly built for OpenAI-compat thinking models

**Bug fix: slashCommands / skills not passed to init message (`core/session.ts`, `index.ts`)**
- `session.stream()` was building `queryOpts` without `slashCommands` / `skills`, so the `system:init` message emitted to the consumer had empty slash command and skill lists regardless of what the host passed in `Options`
- Added `skills: string[]` field to `SessionState`; populated from `options.skills` in `createSession()`
- `stream()` now passes `slashCommands` (mapped to name strings) and `skills` in `queryOpts`
- `query()` in `index.ts` was missing the same — added slash command name extraction + `queryOpts` population

**Enhancement: accurate `duration_api_ms` tracking (`core/query-loop.ts`)**
- Previously both `duration_ms` and `duration_api_ms` in result messages were set to `Date.now() - startTime` (total wall-clock time including tool execution)
- Added `totalApiTimeMs` counter; each `createMessageStream` / `accumulateAndStream` call now wraps the API call with `Date.now()` bookmarks and accumulates elapsed time across turns
- `duration_api_ms` in success and error result messages now reports pure LLM API wait time (tool execution time excluded)

**Fix: `content_block_start` event field naming (`types/provider.ts`)**
- `StreamEvent` for `content_block_start` had `contentBlock` (camelCase) but all usages in `anthropic.ts`, `openai-compat.ts`, and `query-loop.ts` used `content_block` (snake_case)
- Corrected field name to `content_block` — matches the Anthropic wire format and the consumer's CC SDK type expectations

- tsc --noEmit passes

---

### Run 17 — Background Agent Lifecycle + ThinkingBlock Signature Fix

**Bug fix: TaskStopTool / TaskOutputTool disconnected from AgentRegistry (`tools/task/list.ts`, `orchestrator/init.ts`)**
- Background agents were registered in `AgentRegistry` (per-session, per-spawner) but
  `TaskStopTool` / `TaskOutputTool` / `TaskListTool` / `TaskGetTool` all used `taskStore`
  (a separate global store for todo-style tasks). Using `TaskOutput` with a background
  agent's ID returned "Task not found" — making background agents completely unqueryable.
- Added `setAgentRegistry(registry: AgentRegistry | null)` to `tools/task/list.ts`
- `TaskOutputTool`: checks `_agentRegistry.get(taskId)` as fallback when not found in `taskStore`;
  when `block=true` and agent is still running, awaits `entry.done` with a configurable timeout
- `TaskStopTool`: checks `_agentRegistry.get(taskId)` and calls `_agentRegistry.stop()` to abort the agent
- `TaskListTool` / `TaskGetTool`: also surface running agents from the registry
- `orchestrator/init.ts`: calls `setAgentRegistry(registry)` after creating the registry,
  and `setAgentRegistry(null)` in `dispose()` to prevent cross-session leaks

**Enhancement: `TaskOutput` timeout parameter (`tools/task/schema.ts`, `tools/task/list.ts`)**
- Added `timeout` field (number, ms) to `TASK_OUTPUT_INPUT_SCHEMA`
- When `block=true` and a background agent is still running, uses `Promise.race(entry.done, timeout)`
  instead of blocking indefinitely (default: 30 000 ms)
- Returns `retrieval_status: 'not_ready'` when timeout is exceeded

**Bug fix: ThinkingBlock signature not preserved across turns (`types/provider.ts`, `core/query-loop.ts`, `llm/anthropic.ts`)**
- Anthropic extended thinking blocks carry a cryptographic `signature` field that MUST
  be sent back unchanged in subsequent turns — the API verifies it. Without the signature,
  multi-turn conversations with extended thinking fail.
- Added `signature?: string` to `ThinkingBlock` interface
- `accumulateAndStream` now:
  - Resets `thinkingSignature = ''` on each `content_block_start` (thinking)
  - Accumulates `signature_delta` events into `thinkingSignature`
  - Includes `signature` in the final assembled `ThinkingBlock`
- `anthropic.ts` `mapContentBlock()`: includes `raw.signature` when building ThinkingBlock
- `anthropic.ts` `createMessage()`: `thinkingParts` Map changed from `Map<number, string>` to
  `Map<number, {thinking, signature}>`; `signature_delta` events are now tracked; final
  ThinkingBlock assembly includes `signature`
- `anthropic.ts` `normalizeMessages()`: includes `signature` when serializing ThinkingBlock
  for API request body (was silently dropping it)

- tsc --noEmit passes

---

### Run 18 — Consumer Compatibility Audit: CostTracker + PermissionResult + ModelUsage + Error Result

**Bug fix: CostTracker `totalCostUsd` incorrect after model switch (`core/cost.ts`)**
- `totalCostUsd` was a computed getter that multiplied ALL accumulated tokens by
  `this._pricing` — a single pricing instance that changes on every `add(model)` or
  `setModel()` call. After fallback from Opus to Sonnet, all prior Opus tokens were
  retroactively priced at Sonnet rates, yielding a ~5x cost undercount.
- Replaced with `_totalCostUsd` running accumulator: each `add()` call computes the
  per-call cost at the correct model pricing and accumulates it. `totalCostUsd` getter
  now returns the pre-computed sum. `reset()` also clears `_totalCostUsd` and `_modelUsage`.

**Bug fix: PermissionResult deny `message` field required but consumer omits it (`types/config.ts`, `core/query-loop.ts`)**
- Consumer's `createCanUseTool` returns `{ behavior: 'deny', updatedInput }` without
  a `message` field (permission-handler.ts:129). Our SDK required `message: string` on
  the deny variant and read it unconditionally in query-loop.ts:1041, producing
  `"Permission denied: undefined"`.
- Changed `PermissionResult` deny variant: `message` is now optional (`message?: string`).
- Updated query-loop deny handling: uses `permResult.message` when present, falls back
  to `'Permission denied'` when omitted.

**Enhancement: `ModelUsageEntry.contextWindow` field (`core/cost.ts`)**
- Consumer reads `modelUsage[model].contextWindow` from result messages for context
  window display (message-utils.ts:276). Our `ModelUsageEntry` was missing this field,
  causing silent fallback to 200K default.
- Added `contextWindow: number` to `ModelUsageEntry` interface.
- `CostTracker.add()` now calls `contextWindowForModel(modelKey)` when creating a new
  entry, populating the field with the correct per-model context window size.

**Enhancement: error result `result` field + `stop_reason` (`core/query-loop.ts`)**
- Consumer reads `message.result` from all result messages (message-utils.ts:213),
  including errors. Our error result type only had `errors: string[]`, so error messages
  displayed as empty content in the UI.
- Added `result: string` field to error result type — set to `errors.join('\n')`.
- Added `stop_reason: string | null` to error result type for CC SDK conformance.

- tsc --noEmit passes

---

## Priority Queue (Next Runs)

### P1 (Critical)
- [ ] Worker Thread isolation for background agents (true parallelism)

### P2 (Important)
- [ ] WebSearchTool real implementation
- [ ] Agent progress summaries (agentProgressSummaries fork+summarize every 30s)
