/**
 * @module @anthropic-ai/claude-code
 * Public entry point for the Agent-Core SDK.
 *
 * Drop-in replacement for @anthropic-ai/claude-agent-sdk.
 * Provides: query(), createSession(), unstable_v2_createSession(),
 * and all public types.
 *
 * @license MIT
 */

// ---------------------------------------------------------------------------
// Core runtime
// ---------------------------------------------------------------------------

export { createSession } from './core/session.js';
export type { SDKSession } from './core/session.js';
export { queryLoop } from './core/query-loop.js';
export type { SDKMessage, SDKRateLimitInfo, QueryLoopOptions, MutableConfigOverrides } from './core/query-loop.js';
export { CostTracker } from './core/cost.js';
export type { ModelUsageEntry } from './core/cost.js';
export { TokenBudget } from './core/token-budget.js';
export { resolveQueryConfig, createAgentContext } from './core/context.js';
export {
  microCompact,
  apiCompact,
  autoCompactIfNeeded,
  fullCompact,
  AutoCompactState,
  formatCompactSummary,
  getCompactPrompt,
} from './core/compact.js';
export {
  runHooks,
  runPreToolUseHooks,
  runPostToolUseHooks,
  runPostToolUseFailureHooks,
  runEventHooks,
} from './core/hooks.js';
export type {
  PreToolUseHookResult,
  PostToolUseHookResult,
} from './core/hooks.js';

// ---------------------------------------------------------------------------
// query() — the primary public API
// ---------------------------------------------------------------------------

import type {
  Options,
  PermissionMode,
  SlashCommand,
  ModelInfo,
  AgentInfo,
  AccountInfo,
  McpServerStatus,
  McpSetServersResult,
  RewindFilesResult,
  SDKControlInitializeResponse,
  SDKControlGetContextUsageResponse,
} from './types/config.js';
import type { Tool } from './types/tool.js';
import { createSession } from './core/session.js';
import { queryLoop } from './core/query-loop.js';
import type { SDKMessage, QueryLoopOptions, MutableConfigOverrides } from './core/query-loop.js';
import { resolveQueryConfig } from './core/context.js';
import { getAllTools, filterTools } from './tools/registry.js';
import { extractSdkMcpTools } from './tools/mcp/bridge.js';
import type { McpServerConnectionStatus } from './tools/mcp/bridge.js';
import {
  McpConnectionManager,
  createMcpConnectionManager,
} from './tools/mcp/connection-manager.js';
import { initOrchestrator } from './orchestrator/init.js';
import { AnthropicProvider } from './llm/anthropic.js';
import { shellStateManager } from './tools/bash/shell-state.js';
import { backgroundRegistry } from './tools/bash/background.js';

/** Auto-create a provider from options.env or process.env when options.provider is omitted. */
function resolveProvider(options: Options) {
  if (options.provider) return options.provider;
  const env = options.env as Record<string, string | undefined> | undefined;
  // Support CC SDK compat fields: options.apiKey / options.anthropicBaseUrl
  const apiKey = options.apiKey ?? env?.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_API_KEY;
  const baseUrl = options.anthropicBaseUrl ?? env?.ANTHROPIC_BASE_URL ?? process.env.ANTHROPIC_BASE_URL;
  if (!apiKey) {
    throw new Error(
      'query() requires options.provider, options.apiKey, or ANTHROPIC_API_KEY in env.',
    );
  }
  return new AnthropicProvider({ apiKey, baseUrl });
}

/**
 * The Query object — an AsyncGenerator<SDKMessage> with additional
 * control methods for mid-stream interaction.
 *
 * The Query object returned by the `query()` function.
 */
export interface Query extends AsyncGenerator<SDKMessage, void, undefined> {
  /** Interrupt the current query. */
  interrupt(): Promise<void>;
  /** Change the permission mode mid-conversation. */
  setPermissionMode(mode: PermissionMode): Promise<void>;
  /** Change the model mid-conversation. */
  setModel(model?: string): Promise<void>;
  /** Change max thinking tokens mid-conversation. */
  setMaxThinkingTokens(n: number | null): Promise<void>;
  /** Merge settings into the flag settings layer mid-session. */
  applyFlagSettings(settings: Record<string, unknown>): Promise<void>;
  /** Get the full initialization response. */
  initializationResult(): Promise<SDKControlInitializeResponse>;
  /** Get available slash commands. */
  supportedCommands(): Promise<SlashCommand[]>;
  /** Get available models. */
  supportedModels(): Promise<ModelInfo[]>;
  /** Get available sub-agents. */
  supportedAgents(): Promise<AgentInfo[]>;
  /** Get MCP server connection statuses. */
  mcpServerStatus(): Promise<McpServerStatus[]>;
  /** Get context window usage breakdown. */
  getContextUsage(): Promise<SDKControlGetContextUsageResponse>;
  /** Reload plugins from disk. */
  reloadPlugins(): Promise<{ commands: SlashCommand[]; agents: AgentInfo[] }>;
  /** Get account info for the authenticated user. */
  accountInfo(): Promise<AccountInfo>;
  /** Rewind tracked files to their state at a specific user message. */
  rewindFiles(userMessageId: string, options?: { dryRun?: boolean }): Promise<RewindFilesResult>;
  /** Seed the read-file state cache. */
  seedReadState(path: string, mtime: number): Promise<void>;
  /** Reconnect a specific MCP server by name. */
  reconnectMcpServer(serverName: string): Promise<void>;
  /** Enable or disable an MCP server by name. */
  toggleMcpServer(serverName: string, enabled: boolean): Promise<void>;
  /** Replace the set of dynamic MCP servers. */
  setMcpServers(servers: Record<string, unknown>): Promise<McpSetServersResult>;
  /** Stop a running background task. */
  stopTask(taskId: string): Promise<void>;
  /** Close the query and terminate the underlying process. */
  close(): void;
}

/**
 * The main entry point for the Agent-Core SDK.
 *
 * Starts a new agentic query that runs the ReAct loop against the LLM.
 * Returns a Query object (AsyncGenerator<SDKMessage>) that yields events
 * as they are produced.
 *
 * Returns a Query object (AsyncGenerator<SDKMessage>) compatible with the standard query signature.
 *
 * @example
 * ```ts
 * import { query } from '@anthropic-ai/claude-code';
 *
 * const q = query({
 *   prompt: 'Write a hello world function',
 *   options: { model: 'claude-sonnet-4-6', provider: myProvider }
 * });
 *
 * for await (const msg of q) {
 *   console.log(msg.type, msg);
 * }
 * ```
 */
export function query(params: {
  prompt: string | AsyncIterable<{ role: 'user'; content: string }>;
  options?: Options;
}): Query {
  const { prompt, options = {} } = params;

  // Resolve provider — explicit or auto-created from env
  const provider = resolveProvider(options);

  // Resolve config
  const config = resolveQueryConfig(options);
  const abortController = options.abortController ?? new AbortController();
  const configWithSignal = { ...config, abortSignal: abortController.signal };

  // Shared mutable config overrides for Query control methods (C1)
  const configOverrides: MutableConfigOverrides = {};

  // Build tool list (built-in + custom + MCP SDK tools)
  let tools: Tool[];
  if (options.customTools && options.customTools.length > 0) {
    const customToolNames = new Set(options.customTools.map((t) => t.name));
    const builtInTools = getAllTools().filter((t) => !customToolNames.has(t.name));
    tools = [...builtInTools, ...options.customTools];
  } else {
    tools = getAllTools();
  }

  // Bridge SDK MCP server tools into the tool list
  const mcpTools = extractSdkMcpTools(
    options.mcpServers as Record<string, unknown> | undefined,
  );
  if (mcpTools.length > 0) {
    const mcpToolNames = new Set(mcpTools.map((t) => t.name));
    tools = tools.filter((t) => !mcpToolNames.has(t.name));
    tools.push(...mcpTools);
  }

  tools = filterTools(tools, {
    allowedTools: config.allowedTools,
    disallowedTools: config.disallowedTools,
  });

  // Wrap in an async generator that connects external MCP servers first,
  // then runs the query loop, and disconnects on cleanup.
  const mcpServersConfig = options.mcpServers as Record<string, unknown> | undefined;

  // Collect SDK MCP server statuses (in-process — always connected)
  const mcpStatuses: McpServerConnectionStatus[] = [];
  if (mcpServersConfig) {
    for (const [name, cfg] of Object.entries(mcpServersConfig)) {
      if (cfg && typeof cfg === 'object' && (cfg as Record<string, unknown>).type === 'sdk') {
        mcpStatuses.push({ name, status: 'connected' });
      }
    }
  }

  // Hoist the MCP manager so Query control methods (toggleMcpServer/setMcpServers)
  // can mutate it between turns while the generator is running.
  const mcpManager = createMcpConnectionManager(
    mcpServersConfig,
    options.onElicitation ? { onElicitation: options.onElicitation } : undefined,
  );

  // Stable session ID for the lifetime of this one-shot query.
  // Shared with the query loop so that tool state (e.g. shell cwd) can be
  // cleaned up deterministically when the query completes.
  const querySessionId = randomUUID();

  const gen = (async function* (): AsyncGenerator<SDKMessage, void, undefined> {
    // Connect external MCP servers via connection manager (with reconnection support)
    try {
      await mcpManager.connectAll();
      const extTools = mcpManager.getBridgedTools();
      if (extTools.length > 0) {
        const extToolNames = new Set(extTools.map((t) => t.name));
        tools = tools.filter((t) => !extToolNames.has(t.name));
        tools.push(...extTools);
      }
      // Merge external server statuses
      mcpStatuses.push(...mcpManager.getStatuses());
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[SDK] External MCP connection error: ${msg}`);
    }

    // Initialize orchestrator (wires AgentTool spawner + SendMessage router)
    const orchestrator = initOrchestrator({
      provider,
      config: configWithSignal,
      tools,
    });

    // Build slash command names for the init message
    const slashCommandNames: string[] = [];
    if (options.slashCommands) {
      for (const cmd of options.slashCommands) {
        slashCommandNames.push(typeof cmd === 'string' ? cmd : cmd.name);
      }
    }

    const queryOpts: QueryLoopOptions = {
      sessionId: querySessionId,
      mcpServerStatuses: mcpStatuses.length > 0 ? mcpStatuses : undefined,
      slashCommands: slashCommandNames.length > 0 ? slashCommandNames : undefined,
      skills: options.skills && options.skills.length > 0 ? options.skills : undefined,
      configOverrides,
    };

    try {
      if (typeof prompt === 'string') {
        yield* queryLoop(configWithSignal, provider, tools, prompt, queryOpts);
      } else {
        // AsyncIterable prompt — drain the first message to start the loop
        let firstPrompt = '';
        for await (const msg of prompt) {
          firstPrompt = typeof msg.content === 'string' ? msg.content : String(msg.content);
          break;
        }
        if (!firstPrompt) return;
        yield* queryLoop(configWithSignal, provider, tools, firstPrompt, queryOpts);
      }
    } finally {
      // Dispose orchestrator (abort sub-agents, reset stubs)
      orchestrator.dispose();
      // Disconnect all external MCP servers (cancels reconnect loops)
      mcpManager.disconnectAll();
      // Release per-query shell state accumulated by the Bash tool
      shellStateManager.removeAll(querySessionId);
      // Opportunistic pruning: remove completed background tasks older than 1 hour
      backgroundRegistry.pruneCompleted(3_600_000);
    }
  })();

  // Capture metadata for Query control methods
  const queryMeta: QueryMetadata = {
    slashCommands: (options.slashCommands ?? []).map((c) =>
      typeof c === 'string' ? { name: c, description: '' } : c as SlashCommand,
    ),
    agents: options.agents ?? {},
    mcpStatuses: mcpStatuses as unknown as McpServerStatus[],
    config: configWithSignal,
  };

  return wrapGeneratorAsQuery(gen, abortController, configOverrides, queryMeta, mcpManager, tools);
}

/** Internal metadata bag for Query control methods. */
interface QueryMetadata {
  slashCommands: SlashCommand[];
  agents: Record<string, import('./types/config.js').AgentDefinition>;
  mcpStatuses: McpServerStatus[];
  config: import('./types/config.js').QueryConfig;
}

/**
 * Synchronize external MCP tools from the connection manager into a mutable
 * tools array. Removes stale manager-owned tools and appends current ones.
 * In-process (SDK) MCP tools are left untouched.
 */
function syncToolsFromManager(tools: Tool[], mgr: McpConnectionManager): void {
  const managedServers = new Set(mgr.serverNames());

  // Remove tools that belong to any server in the manager
  let i = tools.length;
  while (i-- > 0) {
    const name = tools[i].name;
    if (!name.startsWith('mcp__')) continue;
    const sep = name.indexOf('__', 5);
    if (sep < 0) continue;
    const srv = name.slice(5, sep);
    if (managedServers.has(srv)) tools.splice(i, 1);
  }

  // Append current tools from all connected servers
  for (const t of mgr.getBridgedTools()) {
    tools.push(t);
  }
}

/**
 * Wrap an AsyncGenerator<SDKMessage> with Query control methods.
 * Control methods write to the shared `overrides` object which the
 * query loop reads at the start of each turn (C1).
 *
 * @param mcpManager - Optional external MCP connection manager to expose
 *   via toggleMcpServer / setMcpServers. When provided, dynamic MCP changes
 *   are applied to the manager and take effect on the next tool lookup.
 * @param toolsRef - Mutable tools array shared with the generator closure.
 *   Dynamic MCP changes update this array in-place.
 */
function wrapGeneratorAsQuery(
  gen: AsyncGenerator<SDKMessage, void, undefined>,
  abortController: AbortController,
  overrides: MutableConfigOverrides,
  meta: QueryMetadata,
  mcpManager?: McpConnectionManager,
  toolsRef?: Tool[],
): Query {
  const query = gen as Query;

  query.interrupt = async () => {
    abortController.abort();
  };

  query.setPermissionMode = async (mode: PermissionMode) => {
    overrides.permissionMode = mode;
  };

  query.setModel = async (model?: string) => {
    overrides.model = model;
  };

  query.setMaxThinkingTokens = async (n: number | null) => {
    overrides.maxThinkingTokens = n;
  };

  query.applyFlagSettings = async (_settings: Record<string, unknown>) => {
    // In-process SDK: settings are applied at session creation; mid-session
    // flag settings merging is a no-op for now (no subprocess config reload).
  };

  query.supportedCommands = async () => meta.slashCommands;

  query.supportedModels = async () => {
    // Return a static list of known Claude models.
    // In CC SDK this queries the subprocess; we return the model registry.
    const { getModelRegistry } = await import('./llm/model-registry.js');
    const registry = getModelRegistry();
    return Object.entries(registry).map(([id, info]) => ({
      value: id,
      displayName: info.displayName ?? id,
      description: info.description ?? '',
      supportsEffort: info.supportsEffort,
      supportedEffortLevels: info.supportedEffortLevels,
    }));
  };

  query.supportedAgents = async () =>
    Object.entries(meta.agents).map(([name, def]) => ({
      name,
      description: def.description,
      model: def.model,
    }));

  query.mcpServerStatus = async () => meta.mcpStatuses;

  query.getContextUsage = async () => ({
    usage: {},
    totalTokens: 0,
    contextWindow: 200_000,
  });

  query.reloadPlugins = async () => ({
    commands: meta.slashCommands,
    agents: Object.entries(meta.agents).map(([name, def]) => ({
      name,
      description: def.description,
      model: def.model,
    })),
  });

  query.accountInfo = async () => ({
    apiKeySource: 'user',
  });

  query.rewindFiles = async () => ({
    canRewind: false,
    error: 'File checkpointing is not supported in the in-process SDK.',
  });

  query.seedReadState = async () => {
    // No-op: read state seeding is a CC subprocess optimization.
  };

  query.reconnectMcpServer = async (serverName: string) => {
    if (mcpManager) {
      await mcpManager.restart(serverName);
      // Sync updated tools into the shared tools array (in-place splice)
      if (toolsRef) syncToolsFromManager(toolsRef, mcpManager);
    }
  };

  query.toggleMcpServer = async (serverName: string, enabled: boolean) => {
    if (mcpManager) {
      await mcpManager.toggle(serverName, enabled);
      if (toolsRef) syncToolsFromManager(toolsRef, mcpManager);
    }
  };

  query.setMcpServers = async (servers: Record<string, Record<string, unknown>>) => {
    if (!mcpManager) return { added: [], removed: [], errors: {} };
    const result = await mcpManager.setServers(servers);
    if (toolsRef) syncToolsFromManager(toolsRef, mcpManager);
    return result;
  };

  query.stopTask = async (taskId: string) => {
    // Delegate to AgentRegistry for background agent tasks.
    try {
      const { getAgentRegistry } = await import('./tools/task/list.js');
      const registry = getAgentRegistry();
      if (registry) {
        registry.stop(taskId);
      }
    } catch { /* registry not initialized */ }
  };

  query.initializationResult = async () => ({
    commands: meta.slashCommands,
    models: await query.supportedModels(),
    agents: await query.supportedAgents(),
    accountInfo: await query.accountInfo(),
    outputStyle: meta.config.outputFormat?.type ?? 'text',
    mcpServers: meta.mcpStatuses,
  });

  query.close = () => {
    abortController.abort();
    gen.return(undefined);
  };

  return query;
}

// ---------------------------------------------------------------------------
// unstable_v2_createSession — compatibility alias
// ---------------------------------------------------------------------------

/**
 * Alias for createSession() — exported under the legacy function name
 * `unstable_v2_createSession()` for zero-change compatibility with
 * existing consumer code.
 */
export const unstable_v2_createSession = createSession;

/**
 * Send a single prompt and collect the full result.
 *
 * Convenience wrapper: creates a disposable session, sends the message,
 * streams until a `result` message arrives, then closes the session.
 *
 * Compatible with the CC SDK signature:
 *   `unstable_v2_prompt(message, options): Promise<SDKResultMessage>`
 */
export async function unstable_v2_prompt(
  message: string,
  options: Options,
): Promise<Record<string, unknown>> {
  const session = await createSession(options);
  try {
    await session.send(message);
    for await (const msg of session.stream()) {
      if (msg.type === 'result') {
        return msg as unknown as Record<string, unknown>;
      }
    }
    // Stream ended without a result message — should not happen
    throw new Error('Stream completed without a result message');
  } finally {
    session.close();
  }
}

/**
 * Resume a previous session by its session ID.
 *
 * Creates a session with the supplied `sessionId` and loads conversation
 * history from the transcript file on disk.
 *
 * Compatible with the CC SDK signature:
 *   `unstable_v2_resumeSession(sessionId, options): Promise<SDKSession>`
 */
export async function unstable_v2_resumeSession(
  sessionId: string,
  options: Parameters<typeof createSession>[0],
): ReturnType<typeof createSession> {
  // Pass resume: sessionId so createSession loads conversation history from transcript
  return createSession({ ...options, sessionId, resume: sessionId });
}

// ---------------------------------------------------------------------------
// Types — full re-exports
// ---------------------------------------------------------------------------

export type {
  Options,
  QueryConfig,
  AgentContext,
  PermissionMode,
  PermissionBehavior,
  PermissionDecisionClassification,
  PermissionUpdate,
  PermissionUpdateDestination,
  PermissionRuleValue,
  CanUseTool,
  PermissionResult,
  HookEvent,
  HookCallback,
  HookCallbackMatcher,
  HookInput,
  HookJSONOutput,
  AsyncHookJSONOutput,
  SyncHookJSONOutput,
  BaseHookInput,
  PreToolUseHookInput,
  PostToolUseHookInput,
  PostToolUseFailureHookInput,
  NotificationHookInput,
  UserPromptSubmitHookInput,
  SessionStartHookInput,
  SessionEndHookInput,
  StopHookInput,
  StopFailureHookInput,
  SubagentStartHookInput,
  SubagentStopHookInput,
  PreCompactHookInput,
  PostCompactHookInput,
  PermissionRequestHookInput,
  PermissionDeniedHookInput,
  SetupHookInput,
  TeammateIdleHookInput,
  TaskCreatedHookInput,
  TaskCompletedHookInput,
  ElicitationHookInput,
  ElicitationResultHookInput,
  ConfigChangeHookInput,
  WorktreeCreateHookInput,
  WorktreeRemoveHookInput,
  InstructionsLoadedHookInput,
  CwdChangedHookInput,
  FileChangedHookInput,
  McpStdioServerConfig,
  McpSSEServerConfig,
  McpHttpServerConfig,
  McpServerConfig,
  McpServerStatus,
  McpSetServersResult,
  AgentDefinition,
  AgentInfo,
  AccountInfo,
  OutputFormat,
  SdkBeta,
  SettingSource,
  ModelInfo,
  SlashCommand,
  ThinkingConfig,
  EffortLevel,
  RewindFilesResult,
  SDKControlInitializeResponse,
  SDKControlGetContextUsageResponse,
  SDKPermissionDenial,
  ApiKeySource,
  FastModeState,
  ExitReason,
} from './types/config.js';

export type {
  LlmProvider,
  ProviderRequest,
  ProviderResponse,
  StreamEvent,
  Message,
  ContentBlock,
  TextBlock,
  ToolUseBlock,
  ToolResultBlock,
  ThinkingBlock,
  UsageInfo,
  SystemPromptBlock,
  ToolDefinition,
} from './types/provider.js';

export type {
  Tool,
  ToolResult,
  ToolContext,
  ShellState,
  PermissionLevel,
} from './types/tool.js';

export { toolSuccess, toolError, toToolDefinition } from './types/tool.js';

// ---------------------------------------------------------------------------
// LLM Providers
// ---------------------------------------------------------------------------

export {
  createProvider,
  createWellKnownProvider,
  listWellKnownProviders,
  AnthropicProvider,
  OpenAiCompatProvider,
  parseSSEStream,
  applyModelQuirks,
  applyStreamQuirks,
  isQuirkyModel,
  ModelRegistry,
  getDefaultRegistry,
} from './llm/provider.js';

export type {
  ProviderConfig,
} from './llm/provider.js';

export type {
  AnthropicProviderConfig,
} from './llm/anthropic.js';

export type {
  OpenAiCompatProviderConfig,
  ProviderQuirks,
} from './llm/openai-compat.js';

export { getModelRegistry } from './llm/model-registry.js';
export type {
  ModelRegistryEntry,
} from './llm/model-registry.js';

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

export { getAllTools, filterTools, findToolByName } from './tools/registry.js';

// MCP SDK server — tool() and createSdkMcpServer()
export { tool, createSdkMcpServer } from './tools/mcp/sdk-server.js';
export type {
  SdkMcpToolDefinition,
  CallToolResult,
  ToolAnnotations as McpToolAnnotations,
  CreateSdkMcpServerOptions,
  McpSdkServerConfig,
  McpSdkServerConfigWithInstance,
  SdkMcpServerInstance,
  AnyZodRawShape,
  InferShape,
} from './tools/mcp/sdk-server.js';
export {
  bridgeSdkMcpTools,
  extractSdkMcpTools,
  isSdkMcpServerConfig,
  connectExternalMcpServers,
} from './tools/mcp/bridge.js';
export type { ExternalMcpConnection, McpServerConnectionStatus } from './tools/mcp/bridge.js';

// MCP connection manager (reconnection + health monitoring)
export { McpConnectionManager, createMcpConnectionManager } from './tools/mcp/connection-manager.js';
export type { McpServerLiveStatus, CreateMcpConnectionManagerOptions } from './tools/mcp/connection-manager.js';
export type { McpElicitationHandler } from './tools/mcp/client.js';

// MCP external transport — client, transports, JSON-RPC
export { McpClient } from './tools/mcp/client.js';
export type {
  McpServerCapabilities,
  McpServerInfo,
  McpToolDefinition,
  McpCallToolResult,
} from './tools/mcp/client.js';
export { StdioTransport, SSETransport, HttpTransport } from './tools/mcp/transports.js';
export type {
  StdioTransportOptions,
  SSETransportOptions,
  HttpTransportOptions,
} from './tools/mcp/transports.js';
export type {
  McpTransport,
  JsonRpcRequest,
  JsonRpcNotification,
  JsonRpcResponse,
  JsonRpcError,
} from './tools/mcp/jsonrpc.js';

// Orchestrator
export { initOrchestrator } from './orchestrator/init.js';
export type { OrchestratorHandle } from './orchestrator/init.js';
export { AgentRegistry } from './orchestrator/registry.js';
export type { AgentEntry, AgentStatus } from './orchestrator/registry.js';
export { createSpawner } from './orchestrator/spawner.js';
export type { SpawnerDeps } from './orchestrator/spawner.js';

// Agent tool injection
export { setSpawner } from './tools/agent/index.js';
export type { AgentSpawner, AgentSpawnRequest } from './tools/agent/index.js';
export { setMessageRouter } from './tools/send-message/index.js';
export type { MessageRouter, AgentMessage } from './tools/send-message/index.js';

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

export { assembleSystemPrompt, splitAtBoundary } from './prompt/system-prompt.js';
export type { SystemPromptConfig } from './prompt/system-prompt.js';
export * from './prompt/constants.js';

// ---------------------------------------------------------------------------
// Utils
// ---------------------------------------------------------------------------

export { truncateToolResult } from './utils/truncate.js';
export { estimateTokens, estimateMessageTokens } from './utils/tokens.js';
export {
  SDKError,
  ProviderError,
  AbortError,
  ToolExecutionError,
  BudgetExceededError,
  MaxTurnsExceededError,
  CompactError,
} from './utils/errors.js';

// ---------------------------------------------------------------------------
// Session Management — CC SDK contract stubs
// ---------------------------------------------------------------------------
// These functions match the CC SDK public API surface. They operate on
// transcript files stored in CLAUDE_CONFIG_DIR/projects/<project>/<session>.jsonl.
// Real implementations read/write these files; stubs return empty results.

import { randomUUID } from 'node:crypto';
import {
  transcriptExists,
  getTranscriptPath,
} from './core/transcript.js';
import { readdir, readFile, writeFile, stat, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { basename } from 'node:path';

/** Session info returned by listSessions / getSessionInfo. */
export interface SDKSessionInfo {
  sessionId: string;
  /** Summary / description of the session. */
  summary: string;
  /** ISO timestamp of last modification. */
  lastModified: string;
  /** File size of the transcript in bytes. */
  fileSize?: number;
  /** User-set custom title (via renameSession). */
  customTitle?: string;
  /** First user prompt in the session. */
  firstPrompt?: string;
  /** Git branch at session creation time. */
  gitBranch?: string;
  /** Working directory. */
  cwd?: string;
  /** User-set tag (via tagSession). */
  tag?: string;
  /** ISO timestamp of creation. */
  createdAt?: string;
}

/** Session message returned by getSessionMessages. */
export interface SessionMessage {
  type: 'user' | 'assistant' | 'system';
  uuid: string;
  session_id: string;
  message: unknown;
  parent_tool_use_id: string | null;
}

/** Options for listing sessions. */
export interface ListSessionsOptions {
  /** Project directory path. CC SDK compat alias: `dir`. */
  cwd?: string;
  /** CC SDK contract field — alias for `cwd`. */
  dir?: string;
  limit?: number;
  offset?: number;
  /** When true, include sessions from git worktree paths. */
  includeWorktrees?: boolean;
}

/** Options for getting session info. */
export interface GetSessionInfoOptions {
  cwd?: string;
  /** CC SDK contract field — alias for `cwd`. */
  dir?: string;
}

/** Options for getting session messages. */
export interface GetSessionMessagesOptions {
  cwd?: string;
  /** CC SDK contract field — alias for `cwd`. */
  dir?: string;
  limit?: number;
  offset?: number;
  /** When true, include system messages in the returned list. */
  includeSystemMessages?: boolean;
}

/** Options for getting sub-agent messages. */
export interface GetSubagentMessagesOptions {
  cwd?: string;
  /** CC SDK contract field — alias for `cwd`. */
  dir?: string;
}

/** Options for listing sub-agents. */
export interface ListSubagentsOptions {
  cwd?: string;
}

/** Options for forking a session. */
export interface ForkSessionOptions extends SessionMutationOptions {
  /** Fork up to (and including) this message UUID. */
  upToMessageId?: string;
  /** Title for the forked session. */
  title?: string;
}

/** Result of forking a session. */
export interface ForkSessionResult {
  sessionId: string;
}

/** Options for session mutation operations. */
export interface SessionMutationOptions {
  cwd?: string;
}

/**
 * List sessions for the given working directory.
 * Scans transcript files in CLAUDE_CONFIG_DIR/projects/<project>/.
 */
export async function listSessions(options?: ListSessionsOptions): Promise<SDKSessionInfo[]> {
  const cwd = options?.dir ?? options?.cwd ?? process.cwd();
  const projectDir = getTranscriptPath('_placeholder_', cwd).replace('/_placeholder_.jsonl', '');
  try {
    const files = await readdir(projectDir);
    const sessions: SDKSessionInfo[] = [];
    for (const file of files) {
      if (!file.endsWith('.jsonl')) continue;
      const sessionId = basename(file, '.jsonl');
      const filePath = join(projectDir, file);
      // Read file stats for metadata
      let fileSize: number | undefined;
      let lastModified = '';
      let createdAt: string | undefined;
      try {
        const fstat = await stat(filePath);
        fileSize = fstat.size;
        lastModified = fstat.mtime.toISOString();
        createdAt = fstat.birthtime.toISOString();
      } catch { /* stat failure — use defaults */ }
      sessions.push({
        sessionId,
        summary: '',
        lastModified,
        fileSize,
        cwd,
        createdAt,
      });
    }
    // Sort by lastModified descending (most recent first)
    sessions.sort((a, b) => (b.lastModified > a.lastModified ? 1 : -1));
    // Apply pagination
    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? sessions.length;
    const paged = sessions.slice(offset, offset + limit);
    // Enrich with sidecar metadata in parallel
    await Promise.all(paged.map(async (s) => {
      const meta = await readMeta(s.sessionId, cwd);
      if (meta.title) s.customTitle = meta.title;
      if (meta.tag !== undefined && meta.tag !== null) s.tag = meta.tag;
    }));
    return paged;
  } catch {
    return [];
  }
}

/**
 * Get info about a specific session.
 */
export async function getSessionInfo(
  sessionId: string,
  options?: GetSessionInfoOptions,
): Promise<SDKSessionInfo | undefined> {
  const cwd = options?.dir ?? options?.cwd ?? process.cwd();
  if (!transcriptExists(sessionId, cwd)) return undefined;
  const filePath = getTranscriptPath(sessionId, cwd);
  let fileSize: number | undefined;
  let lastModified = '';
  let createdAt: string | undefined;
  try {
    const fstat = await stat(filePath);
    fileSize = fstat.size;
    lastModified = fstat.mtime.toISOString();
    createdAt = fstat.birthtime.toISOString();
  } catch { /* stat failure — use defaults */ }
  const info: SDKSessionInfo = { sessionId, summary: '', lastModified, fileSize, cwd, createdAt };
  // Enrich with sidecar metadata (custom title / tag)
  const meta = await readMeta(sessionId, cwd);
  if (meta.title) info.customTitle = meta.title;
  if (meta.tag !== undefined && meta.tag !== null) info.tag = meta.tag;
  return info;
}

/**
 * Get messages from a session transcript.
 */
export async function getSessionMessages(
  sessionId: string,
  options?: GetSessionMessagesOptions,
): Promise<SessionMessage[]> {
  const cwd = options?.dir ?? options?.cwd ?? process.cwd();
  const filePath = getTranscriptPath(sessionId, cwd);
  try {
    const content = await readFile(filePath, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    const messages: SessionMessage[] = [];
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        const isConversation = entry.type === 'user' || entry.type === 'assistant';
        const isSystem = entry.type === 'system';
        if (isConversation || (isSystem && options?.includeSystemMessages)) {
          messages.push({
            type: entry.type,
            uuid: entry.uuid ?? '',
            session_id: entry.sessionId ?? sessionId,
            message: entry.message ?? null,
            parent_tool_use_id: entry.parent_tool_use_id ?? null,
          });
        }
      } catch { /* skip malformed lines */ }
    }
    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? messages.length;
    return messages.slice(offset, offset + limit);
  } catch {
    return [];
  }
}

/**
 * Get messages from a sub-agent within a session.
 */
export async function getSubagentMessages(
  _sessionId: string,
  _agentId: string,
  _options?: GetSubagentMessagesOptions,
): Promise<SessionMessage[]> {
  // Sub-agent messages are interleaved in the main transcript.
  // Filtering by agentId requires isSidechain metadata — not yet tracked.
  return [];
}

/**
 * List sub-agents that participated in a session.
 */
export async function listSubagents(
  _sessionId: string,
  _options?: ListSubagentsOptions,
): Promise<string[]> {
  return [];
}

/**
 * Fork a session, optionally truncating at a specific message UUID.
 */
export async function forkSession(
  sessionId: string,
  options?: ForkSessionOptions,
): Promise<ForkSessionResult> {
  const cwd = options?.cwd ?? process.cwd();
  const filePath = getTranscriptPath(sessionId, cwd);
  const newSessionId = randomUUID();
  try {
    const content = await readFile(filePath, 'utf-8');
    const rawLines = content.trim().split('\n').filter(Boolean);
    // If upToMessageId is specified, truncate at (and include) that message
    const linesToCopy: string[] = [];
    for (const line of rawLines) {
      linesToCopy.push(line);
      if (options?.upToMessageId) {
        try {
          const entry = JSON.parse(line);
          if (entry.uuid === options.upToMessageId) break;
        } catch { /* malformed line — keep it */ }
      }
    }
    if (linesToCopy.length > 0) {
      // Rewrite sessionId in each entry for the forked session
      const forkedLines = linesToCopy.map((line) => {
        try {
          const entry = JSON.parse(line);
          entry.sessionId = newSessionId;
          return JSON.stringify(entry);
        } catch {
          return line;
        }
      });
      const newPath = getTranscriptPath(newSessionId, cwd);
      await writeFile(newPath, forkedLines.join('\n') + '\n', 'utf-8');
    }
  } catch { /* source transcript missing or unreadable */ }
  return { sessionId: newSessionId };
}

// ---------------------------------------------------------------------------
// Session metadata sidecar helpers
// ---------------------------------------------------------------------------

/** Sidecar metadata stored alongside a session transcript. */
interface SessionMetadata {
  title?: string;
  tag?: string | null;
}

/** Path to the sidecar metadata file for a given session. */
function metaPath(sessionId: string, cwd: string): string {
  return getTranscriptPath(sessionId, cwd).replace(/\.jsonl$/, '.meta.json');
}

/** Read sidecar metadata; returns `{}` when absent or malformed. */
async function readMeta(sessionId: string, cwd: string): Promise<SessionMetadata> {
  try {
    const raw = await readFile(metaPath(sessionId, cwd), 'utf-8');
    return JSON.parse(raw) as SessionMetadata;
  } catch {
    return {};
  }
}

/** Merge `patch` into the existing sidecar metadata (atomic write). */
async function writeMeta(sessionId: string, cwd: string, patch: Partial<SessionMetadata>): Promise<void> {
  const existing = await readMeta(sessionId, cwd);
  const updated = { ...existing, ...patch };
  // Omit null tag so the field is absent rather than explicit null
  if (updated.tag === null) delete updated.tag;
  const filePath = metaPath(sessionId, cwd);
  // Ensure directory exists before writing
  const dir = filePath.slice(0, filePath.lastIndexOf('/'));
  await mkdir(dir, { recursive: true }).catch(() => {});
  await writeFile(filePath, JSON.stringify(updated, null, 2) + '\n', 'utf-8');
}

// ---------------------------------------------------------------------------
// renameSession / tagSession — real implementations backed by sidecar
// ---------------------------------------------------------------------------

/**
 * Rename a session by persisting a custom title to the metadata sidecar.
 */
export async function renameSession(
  sessionId: string,
  title: string,
  options?: SessionMutationOptions,
): Promise<void> {
  const cwd = options?.cwd ?? process.cwd();
  try {
    await writeMeta(sessionId, cwd, { title });
  } catch { /* advisory — transcript directory may not exist yet */ }
}

/**
 * Tag a session (pass `null` to clear the tag).
 */
export async function tagSession(
  sessionId: string,
  tag: string | null,
  options?: SessionMutationOptions,
): Promise<void> {
  const cwd = options?.cwd ?? process.cwd();
  try {
    await writeMeta(sessionId, cwd, { tag });
  } catch { /* advisory */ }
}

