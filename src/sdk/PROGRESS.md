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
- **orchestrator/** — empty directory. No Worker Thread sub-agent support.
- **tools/mcp/** — external MCP client/transport (stdio, sse, http) not implemented.
- **WebSearchTool** — stub, returns placeholder message.
- **AgentTool** — stub when no spawner registered (orchestrator dependency).
- **TeamCreateTool** — stub when no agent runner registered.
- **Hook system** — defined in config but never invoked in query loop.
- **Effort level** — accepted in config but not mapped to provider request.
- **Query control methods** — setModel/setMaxThinkingTokens/setPermissionMode are no-ops.

### Known Issues (not yet fixed)
- microCompact skips array-typed tool_result content (only handles string)
- Anthropic listModels() is hardcoded (3 models, no API call)
- OpenAI-compat listModels() hardcodes contextWindow/maxOutputTokens for all models
- TodoWrite schema expects `id` field but LLM sends `activeForm` field
- TaskStopTool only updates metadata, doesn't actually kill processes
- TaskOutputTool `block` parameter is a no-op
- GlobTool skips all hidden directories
- Duplicated retry logic between Anthropic and OpenAI-compat providers

### What Works (added Run 2)
- **tool() + createSdkMcpServer()** — exported. In-process MCP SDK server support.
- **MCP tool bridging** — SDK MCP tools are auto-discovered and injected into the query loop.
- **McpSdkServerConfigWithInstance** — type added to McpServerConfig union.
- **Zod→JSON Schema conversion** — for MCP tool input schemas (Zod 3/4 compatible).

---

## Changelog

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
