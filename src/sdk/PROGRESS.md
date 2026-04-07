# Agent-Core SDK Progress

## Current State

tsc --noEmit passes. Core architecture (types, LLM providers, tools, query loop, session, compact, prompt) is implemented. SDK can run end-to-end with Anthropic or OpenAI-compatible providers.

### What Works
- Types: full config, provider, tool type definitions
- LLM: Anthropic provider + OpenAI-compat provider with quirks for DeepSeek/Qwen/etc.
- Tools: 27 built-in tools (bash, read, write, edit, grep, glob, notebook-edit, web-fetch, web-search, agent, skill, todo-write, ask-user, send-message, plan-mode enter/exit, worktree enter/exit, cron CRUD, task CRUD, team CRUD)
- Core: query loop (ReAct), 3-tier compact (micro/api/full), cost tracking, token budget, session
- Prompt: system prompt assembly with cacheable/dynamic boundary
- Public API: query(), createSession(), unstable_v2_createSession()

### What's Missing / Stub
- **WebSearchTool** — stub, returns placeholder message.
- **TeamCreateTool** — stub when no agent runner registered.
- **Effort level** — accepted in config but not mapped to provider request.
- **Query control methods** — setModel/setMaxThinkingTokens/setPermissionMode are no-ops.

### Known Issues (not yet fixed)
- Anthropic listModels() is hardcoded (3 models, no API call)
- OpenAI-compat listModels() hardcodes contextWindow/maxOutputTokens for all models
- TaskStopTool only updates metadata, doesn't actually kill processes
- TaskOutputTool `block` parameter is a no-op
- GlobTool skips all hidden directories
- Duplicated retry logic between Anthropic and OpenAI-compat providers

### What Works (added Run 2)
- **tool() + createSdkMcpServer()** — exported. In-process MCP SDK server support.
- **MCP tool bridging** — SDK MCP tools are auto-discovered and injected into the query loop.
- **McpSdkServerConfigWithInstance** — type added to McpServerConfig union.
- **Zod→JSON Schema conversion** — for MCP tool input schemas (Zod 3/4 compatible).

### What Works (added Run 3)
- **External MCP transport** — stdio, SSE, and streamable-http transports fully implemented.
- **McpClient** — JSON-RPC 2.0 client with initialize handshake, tool discovery, and tool invocation.
- **connectExternalMcpServers()** — async connect, handshake, tool bridge for all external configs.
- **Session/query lifecycle** — external MCP servers auto-connected at startup, disconnected on close.
- **Graceful degradation** — individual server failures are logged and skipped, don't block others.

### What Works (added Run 4)
- **Orchestrator** — in-process sub-agent spawning (foreground + background). `orchestrator/` is no longer empty.
- **AgentTool** — fully wired to the real spawner via `initOrchestrator()`. Sub-agents run their own query loop.
- **Background agents** — fire-and-forget mode with `AgentRegistry` for tracking status/result.
- **TodoWrite** — fixed schema mismatch (`id` → `activeForm`), tool was completely broken before.
- **Exports** — `initOrchestrator`, `AgentRegistry`, `createSpawner`, `setSpawner`, `setMessageRouter` all public.

### What Works (added Run 5)
- **Hook system** — `core/hooks.ts` module with full PreToolUse/PostToolUse/PostToolUseFailure lifecycle. Hooks fire in the query loop around every tool execution, with tool-name matching, timeout enforcement, and sequential execution.
- **PreToolUse hooks** — can deny tool execution, modify input, or add context. Fired before `canUseTool` permission check.
- **PostToolUse hooks** — can append additional context to tool results. Fired after successful execution.
- **PostToolUseFailure hooks** — fire on tool execution errors. Advisory only.
- **microCompact array content** — now handles `string | ContentBlock[]` tool_result content. Previously only counted string content, silently ignoring array-typed content (images, nested blocks).
- **buildTranscript array content** — full compact transcript builder now extracts text from array-typed tool_result content blocks instead of showing `[complex content]`.
- **Generic hook runner** — `runEventHooks()` exported for SessionStart/SessionEnd/PreCompact/PostCompact and other lifecycle events.

---

## Changelog

### 2026-04-08 — Run 5: Hook system + microCompact fix

**Implemented hook system integration in query loop and fixed array-typed tool_result handling**

Two important improvements: (1) the hook system was defined in config types but never invoked — now PreToolUse/PostToolUse/PostToolUseFailure hooks fire in the query loop around every tool execution, (2) microCompact was silently ignoring tool_result content when it was an array of content blocks (e.g., images, nested text blocks).

**New files:**
- `core/hooks.ts` — Hook execution engine. Exports `runHooks()` (generic), `runPreToolUseHooks()`, `runPostToolUseHooks()`, `runPostToolUseFailureHooks()`, `runEventHooks()`. Features: tool-name matching (exact + glob trailing `*`), configurable timeout (default 60s), sequential execution (order-preserving), graceful error handling (hooks are advisory — errors logged but don't break tool execution).

**Changes:**
- `core/query-loop.ts` — tool execution section now calls PreToolUse hooks before `canUseTool`, PostToolUse hooks after success, PostToolUseFailure hooks on error. PreToolUse hooks can: deny execution (returns error to LLM), modify input (merged before execution), add context (prepended to result). PostToolUse hooks can: append additional context to tool results.
- `core/compact.ts` — `microCompact()` and `totalToolResultChars()` now handle `ContentBlock[]`-typed tool_result content via new `toolResultContentSize()` helper. Counts text blocks, nested tool_results, and base64 data blocks. `buildTranscript()` now extracts text from array-typed tool_result content blocks.
- `index.ts` — exports `runHooks`, `runPreToolUseHooks`, `runPostToolUseHooks`, `runPostToolUseFailureHooks`, `runEventHooks`, `PreToolUseHookResult`, `PostToolUseHookResult`.

### 2026-04-08 — Run 4: Orchestrator + TodoWrite fix

**Implemented in-process sub-agent spawning (foreground + background) and fixed TodoWrite**

Two critical improvements: (1) the orchestrator/ directory was empty — now it contains the full agent spawning infrastructure, (2) TodoWrite was completely non-functional because the LLM sends `{content, status, activeForm}` but the tool expected `{id, content, status}`.

**New files:**
- `orchestrator/registry.ts` — `AgentRegistry` class: tracks running/completed/failed/stopped agents with abort, lifecycle timestamps, collected messages, and done promise.
- `orchestrator/spawner.ts` — `createSpawner()` factory: builds an `AgentSpawner` that runs child `queryLoop()` in-process. Supports foreground (blocking) and background (fire-and-forget) modes. Resolves model aliases (sonnet/opus/haiku), filters tools (excludes Agent to prevent recursion), builds sub-agent system prompt from AgentDefinition or defaults.
- `orchestrator/init.ts` — `initOrchestrator()`: one-call setup that wires `setSpawner()` on AgentTool and `setMessageRouter()` on SendMessageTool. Returns `OrchestratorHandle` with dispose for cleanup.

**Changes:**
- `core/session.ts` — `createSession()` now calls `initOrchestrator()` after building tools, `close()` disposes the orchestrator before aborting.
- `index.ts` — `query()` now initializes/disposes orchestrator around the query loop. Exports all orchestrator types and injection functions.
- `tools/agent/index.ts` — `setSpawner()` now accepts `null` for reset. Updated JSDoc (no longer "Phase 3 stub").
- `tools/send-message/index.ts` — `setMessageRouter()` now accepts `null` for reset.
- `tools/todo-write/schema.ts` — replaced `id` property with `activeForm`, updated `required` to `['content', 'status', 'activeForm']`.
- `tools/todo-write/index.ts` — replaced `TodoItem.id` with `TodoItem.activeForm`, deduplication keyed by `content`, transition validation keyed by `content`, output shows `activeForm` for in-progress items.

### 2026-04-08 — Run 3: External MCP transport (P0 compatibility)

**Implemented stdio, SSE, and streamable-http MCP transports — the largest gap for drop-in replacement**

Consumer code (hello-halo) passes database-sourced MCP servers with stdio/sse/http transport types. Without external MCP support, those tools were invisible to the query loop. This run closes that gap.

**New files:**
- `tools/mcp/jsonrpc.ts` — JSON-RPC 2.0 types and `McpTransport` interface
- `tools/mcp/transports.ts` — `StdioTransport` (child process, newline-delimited JSON), `SSETransport` (Server-Sent Events with endpoint discovery), `HttpTransport` (Streamable HTTP with SSE response parsing)
- `tools/mcp/client.ts` — `McpClient` class: MCP handshake (protocol version 2024-11-05), tool discovery (`tools/list`), tool invocation (`tools/call`)

**Changes:**
- `tools/mcp/bridge.ts` — added `connectExternalMcpServers()` and `createExternalBridgedTool()`. SDK and external tools now share a common `formatCallToolResult()` helper. Exports `ExternalMcpConnection` type.
- `core/session.ts` — `createSession()` now connects external MCP servers during init and disconnects them on `close()`
- `index.ts` — `query()` now wraps its generator to connect external MCP servers before the loop and disconnect in `finally`

**Transport details:**
- **Stdio**: Spawns child process, communicates via stdin/stdout, handles process exit/error/SIGTERM+SIGKILL grace period
- **SSE**: Connects to SSE URL, waits for `endpoint` event, POSTs JSON-RPC to endpoint, receives responses via SSE stream
- **HTTP**: Stateless POST to URL, handles both plain JSON and SSE-streamed responses
- All transports: 30s request timeout, proper pending request cleanup, graceful degradation on failure

### 2026-04-08 — Run 2: tool() + createSdkMcpServer() (P0 compatibility)

**Implemented `tool()` and `createSdkMcpServer()` — the most critical missing exports**

These two functions are used by 10+ consumer files in hello-halo (report-tool, notify-tool, memory-snapshot, ai-browser tools, web-search, conversation-mcp, etc.). Without them, the SDK cannot be used as a drop-in replacement.

**New files:**
- `tools/mcp/sdk-server.ts` — `tool()` factory, `createSdkMcpServer()`, `SdkMcpToolDefinition` type, Zod→JSON Schema converter, in-process MCP server instance
- `tools/mcp/bridge.ts` — bridges SDK MCP tools into `Tool[]` for the query loop, with `mcp__{server}__{tool}` naming convention

**Changes:**
- `types/config.ts` — added `McpSdkServerConfig`, `McpSdkServerConfigWithInstance` to `McpServerConfig` union
- `core/session.ts` — `createSession()` now extracts and bridges SDK MCP tools at startup
- `index.ts` — `query()` now extracts and bridges SDK MCP tools; exports `tool`, `createSdkMcpServer`, and all MCP types

**How it works:**
1. Consumer calls `tool(name, desc, schema, handler)` → returns `SdkMcpToolDefinition`
2. Consumer calls `createSdkMcpServer({ name, tools })` → returns `McpSdkServerConfigWithInstance`
3. Consumer passes server into `options.mcpServers` (same as stdio/sse/http configs)
4. SDK startup calls `extractSdkMcpTools(mcpServers)` to detect SDK-type configs
5. Each MCP tool is wrapped as a `Tool` with `mcp__{server}__{tool}` naming
6. Query loop executes MCP tools like any other tool — handler is called directly (no transport)
7. `CallToolResult.content` blocks are serialized to a flat text string for the LLM

### 2026-04-07 — Run 1: Foundation fixes

**Created `index.ts` entry point (P0)**
- Exports `query()` function with full `Query` interface (interrupt, setModel, setMaxThinkingTokens, setPermissionMode)
- Exports `unstable_v2_createSession` as alias for `createSession()` (CC SDK compat)
- Re-exports all public types, providers, tools, prompt, and util modules
- Proper `Query` wrapper with `wrapGeneratorAsQuery()` pattern

**Fixed query-loop stream_event/tool_progress yielding (P1)**
- `stream_event` messages were only passed to `onProgress` callback, never yielded from the generator
- `tool_progress` messages (running/completed/error) were only passed to callback
- Both are now collected during async operations and yielded from the generator after completion
- Consumers using `for await (const msg of query(...))` now receive all message types

**Fixed session.ts user message preservation (P1)**
- User messages were not added to `state.messages` before calling queryLoop
- Second `send()` call would have incomplete conversation history
- Now user messages are pushed to `state.messages` before the query loop runs
- Fixed `isFirstTurn` check for init event suppression (was checking `state.messages.length > 0` which was always true after first message)
- Removed contradictory custom tools logic (tools was set then immediately overwritten)

**Fixed apiCompact tool_use/tool_result pair splitting (P1)**
- `messages.slice(keepFrom)` could start on a tool_result user message whose corresponding tool_use was trimmed
- Added `adjustForToolPairing()` to detect when split point lands on tool_result and step back to include the assistant message
- Prevents API rejection due to orphaned tool_result blocks

**Removed dead code**
- Removed unused `sleep()` helper from session.ts (replaced busy-wait with Promise-based wait)
