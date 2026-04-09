# Agent-Core SDK — Development Progress

Drop-in replacement for `@anthropic-ai/claude-agent-sdk`.
In-process execution, OpenAI-compat providers, Worker Thread multi-agent isolation.

## Status: Active Development | Branch: `feature/sdk`

---

## Completed Runs Summary (1–28)

| Run | Key Change |
|-----|-----------|
| 1 | Foundation: `index.ts` public API, 4 critical bug fixes |
| 2 | `tool()` factory + `createSdkMcpServer()` in-process MCP (P0 compat) |
| 3 | stdio/SSE/http MCP transports, MCP protocol 2024-11-05 |
| 4 | Foreground+background sub-agent spawning; TodoWrite schema fix |
| 5 | PreToolUse/PostToolUse hooks; `microCompact` array content fix |
| 6 | snake_case SDKMessage wire format; uuid on all variants; V2 session control |
| 7 | Effort level mapping; init message mcp_servers/slash_commands/skills/agents |
| 8 | `McpConnectionManager`: reconnection, health monitoring, backoff |
| 9 | session.pid/query.transport/abortController; compact_boundary shape; SDKMessage uuids |
| 10 | SessionStart/End/UserPromptSubmit/PreCompact/PostCompact hooks |
| 11 | Stateful `ThinkTagParser` for Qwen; `unstable_v2_resumeSession`; Anthropic `listModels` |
| 12 | Sub-agent message forwarding; task_started/progress/notification lifecycle events |
| 13 | `utils/retry.ts` dedup; GlobTool hidden-dir fix; `Retry-After` HTTP-date support |
| 14 | `core/transcript.ts`: CC-compatible JSONL read/write; `resume` option |
| 15 | AbortSignal forwarded to providers; abort-aware retry sleeps in all providers |
| 16 | `reasoning_delta` accumulation fix; slashCommands/skills propagation; `duration_api_ms` |
| 17 | ThinkingBlock `signature` preservation; TaskStop/TaskOutput → AgentRegistry bridge |
| 18 | CostTracker running accumulator; `PermissionResult.message` optional; `ModelUsage.contextWindow` |
| 19 | Multi-modal `send()` (3 envelope shapes); git worktree isolation for sub-agents |
| 20 | WebSearch: Brave API + DuckDuckGo fallback; dynamic `currentDate` in description |
| 21 | `agents` field fix (strings not objects); `task_started.description`; stream concurrency guard |
| 22 | Init message CC SDK contract; `permissionMode` propagation; `session_state_changed` events |
| 23 | Adaptive thinking (`type:'adaptive'`) for Opus 4.6+; permission denial tracking + interrupt |
| 24 | Stale-config fix (spawner getter pattern); `setMaxThinkingTokens` adaptive mapping |
| 25 | Full CC SDK type alignment: Options, CanUseTool, PermissionResult, HookEvent, SDKMessage variants |
| 26 | `rate_limit_event`/`prompt_suggestion` top-level type fix; `SDKRateLimitInfo`; stream wire format |
| 27 | **CRITICAL**: `system:init` per-turn fix; `interrupt()` idle wake; session management API |
| 28 | Full Query interface (16 methods); CC SDK types (ModelInfo, AgentInfo, etc.); `bypassPermissions` |

---

## Recent Runs (Detail)

### Run 29 — Unit Test Coverage for Core Modules
- Added 7 test files: `cost`, `compact`, `hooks`, `messages`, `transcript`, `retry`, `tokens`
- **122 unit tests + 14 e2e = 136 passing**

### Run 30 — Dynamic MCP Server Management
- `McpConnectionManager.removeServer()`, `toggle()`, `setServers()` implemented
- Session + query() paths both support real-time MCP server changes via `refreshMcpToolsFromManager`
- **28 new tests (connection-manager.test.ts) — 164 tests total**

### Run 31 — Query-Loop + Spawner Unit Tests + Token Tracking Fix
- **Bug fix**: `total_tokens: 0` in task_progress/notification — now accumulates from assistant message usage
- **20 new tests** in `core/query-loop.test.ts` (mock provider, zero network)
- **12 new tests** in `orchestrator/spawner.test.ts` (foreground/background/lifecycle/tokens)
- **214 tests total**

### Run 32 — MCP Elicitation Support
- Full MCP elicitation pipeline: server-initiated `elicitation/create` requests
- Transport layer: `setRequestHandler(method, handler)` on all 3 transports (stdio/SSE/http)
- `McpClient`: registers `elicitation/create` handler, passes `serverName` to consumer
- `McpConnectionManager.setElicitationHandler()`; wired through `createSession` / `query`
- **11 new tests (tools/mcp/elicitation.test.ts) — 225 tests total**

### Run 33 — Session Unit Tests
- **27 new tests** in `core/session.test.ts` covering full V2 session lifecycle:
  init/result shapes, multi-turn, send() input shapes (string/Message/envelope/multimodal),
  session control (interrupt/close/setModel), options forwarding, concurrent stream guard,
  transcript persistence + resume
- **252 tests total**

### Run 34 — SDKSessionInfo Type Contract Fix
- **Bug fix**: `lastModified`/`createdAt` were strings — now numeric ms epoch (CC SDK contract)
- **Bug fix**: `listSessions` sort was string comparison — now numeric subtraction
- **Enhancement**: `firstPrompt` populated via minimal `FileHandle.read(8KB)` I/O
- **Enhancement**: `summary` now `customTitle ?? firstPrompt ?? sessionId`
- **8 new tests (session-metadata.test.ts) — 260 tests total**

### Run 35 — Sub-agent Transcript Persistence
- **Previous state**: `listSubagents`/`getSubagentMessages` were stubs returning `[]`
- **Directory layout** mirrors CC SDK:
  `<configDir>/projects/<projectDir>/<parentSessionId>/subagents/agent-<agentId>.jsonl`
- **New `transcript.ts` exports**: `getSubagentDir`, `getSubagentTranscriptPath`,
  `writeSubagentTranscript`, `listSubagentIds`, `readSubagentMessages`
- **Spawner**: after each sub-agent run, calls `writeSubagentTranscript` fire-and-forget
- **`index.ts`**: `listSubagents` + `getSubagentMessages` now read from disk (not stubs)
- Options enrichment: `GetSubagentMessagesOptions` adds `limit`/`offset`;
  `ListSubagentsOptions` adds `dir`
- **9 new tests (transcript.test.ts extended) — 269 tests total**

---

## Priority Queue (Next Runs)

### P1 (Critical)
- [ ] Full consumer compatibility e2e test (session send+stream, all SDKMessage shapes)

### P2 (Important)
- [ ] Implement `getSubagentMessages`/`listSubagents` sidechain reading (partially done: transcript written, query reads by dir)
- [ ] Agent progress summaries (`agentProgressSummaries` fork+summarize every 30s)
- [ ] Worker Thread isolation for background agents (deferred)
