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
export type { SDKMessage } from './core/query-loop.js';
export { CostTracker } from './core/cost.js';
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

// ---------------------------------------------------------------------------
// query() — the primary public API
// ---------------------------------------------------------------------------

import type { Options } from './types/config.js';
import type { Tool } from './types/tool.js';
import { createSession } from './core/session.js';
import { queryLoop } from './core/query-loop.js';
import type { SDKMessage } from './core/query-loop.js';
import { resolveQueryConfig } from './core/context.js';
import { getAllTools, filterTools } from './tools/registry.js';
import { extractSdkMcpTools } from './tools/mcp/bridge.js';

/**
 * The Query object — an AsyncGenerator<SDKMessage> with additional
 * control methods for mid-stream interaction.
 *
 * Mirrors the CC SDK Query interface from sdk-types.ts.
 */
export interface Query extends AsyncGenerator<SDKMessage, void, undefined> {
  /** Interrupt the current query. */
  interrupt(): Promise<void>;
  /** Change the permission mode mid-conversation. */
  setPermissionMode(mode: string): Promise<void>;
  /** Change the model mid-conversation. */
  setModel(model?: string): Promise<void>;
  /** Change max thinking tokens mid-conversation. */
  setMaxThinkingTokens(n: number | null): Promise<void>;
}

/**
 * The main entry point for the Agent-Core SDK.
 *
 * Starts a new agentic query that runs the ReAct loop against the LLM.
 * Returns a Query object (AsyncGenerator<SDKMessage>) that yields events
 * as they are produced.
 *
 * Compatible with CC SDK's `query()` signature.
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

  // Resolve provider
  const provider = options.provider;
  if (!provider) {
    throw new Error(
      'query() requires options.provider. Use createProvider() to create an LlmProvider instance.',
    );
  }

  // Resolve config
  const config = resolveQueryConfig(options);
  const abortController = options.abortController ?? new AbortController();
  const configWithSignal = { ...config, abortSignal: abortController.signal };

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

  // If prompt is a string, start the query loop directly
  if (typeof prompt === 'string') {
    const gen = queryLoop(configWithSignal, provider, tools, prompt);
    return wrapGeneratorAsQuery(gen, abortController);
  }

  // If prompt is an AsyncIterable, handle streaming input
  // For the initial implementation, we drain the first message to start the loop.
  const gen = (async function* (): AsyncGenerator<SDKMessage, void, undefined> {
    let firstPrompt = '';
    for await (const msg of prompt) {
      firstPrompt = typeof msg.content === 'string' ? msg.content : String(msg.content);
      break; // Take the first message to start the loop
    }
    if (!firstPrompt) return;
    yield* queryLoop(configWithSignal, provider, tools, firstPrompt);
  })();

  return wrapGeneratorAsQuery(gen, abortController);
}

/**
 * Wrap an AsyncGenerator<SDKMessage> with Query control methods.
 */
function wrapGeneratorAsQuery(
  gen: AsyncGenerator<SDKMessage, void, undefined>,
  abortController: AbortController,
): Query {
  const query = gen as Query;

  query.interrupt = async () => {
    abortController.abort();
  };

  query.setPermissionMode = async (_mode: string) => {
    // Permission mode changes are handled at the host level.
    // The SDK preserves the canUseTool callback interface.
  };

  query.setModel = async (_model?: string) => {
    // Model changes mid-stream are not yet supported in the in-process SDK.
    // This would require the query loop to check for model change signals.
  };

  query.setMaxThinkingTokens = async (_n: number | null) => {
    // Thinking token changes mid-stream are not yet supported.
  };

  return query;
}

// ---------------------------------------------------------------------------
// unstable_v2_createSession — CC SDK compatibility alias
// ---------------------------------------------------------------------------

/**
 * Alias for createSession() — mirrors the CC SDK's
 * `unstable_v2_createSession()` function name.
 *
 * The Agent-Core SDK uses the stable `createSession()` name internally,
 * but exports this alias for zero-change compatibility with code that
 * was written against the CC SDK.
 */
export const unstable_v2_createSession = createSession;

// ---------------------------------------------------------------------------
// Types — full re-exports
// ---------------------------------------------------------------------------

export type {
  Options,
  QueryConfig,
  AgentContext,
  PermissionMode,
  CanUseTool,
  PermissionResult,
  HookEvent,
  HookCallback,
  HookCallbackMatcher,
  McpStdioServerConfig,
  McpSSEServerConfig,
  McpHttpServerConfig,
  McpServerConfig,
  McpServerStatus,
  McpSetServersResult,
  AgentDefinition,
  OutputFormat,
  SdkBeta,
  SettingSource,
  ModelInfo,
  SlashCommand,
  ThinkingConfig,
  EffortLevel,
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
export { bridgeSdkMcpTools, extractSdkMcpTools, isSdkMcpServerConfig } from './tools/mcp/bridge.js';

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
