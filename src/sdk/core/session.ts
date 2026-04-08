/**
 * @module core/session
 * V2Session — stateful send/stream/close interface for the Agent-Core SDK.
 * Mirrors CC SDK's `createSession()` / `SDKSession`.
 * @license MIT
 */

import { randomUUID } from 'node:crypto';
import type { Message, LlmProvider } from '../types/provider.js';
import type { Tool } from '../types/tool.js';
import type { Options, QueryConfig, PermissionMode } from '../types/config.js';
import { resolveQueryConfig } from './context.js';
import { queryLoop } from './query-loop.js';
import type { SDKMessage, QueryLoopOptions } from './query-loop.js';
import type { McpServerConnectionStatus } from '../tools/mcp/bridge.js';
import { getAllTools, filterTools } from '../tools/registry.js';
import { extractSdkMcpTools, connectExternalMcpServers } from '../tools/mcp/bridge.js';
import type { ExternalMcpConnection } from '../tools/mcp/bridge.js';
import { initOrchestrator } from '../orchestrator/init.js';
import type { OrchestratorHandle } from '../orchestrator/init.js';

// ---------------------------------------------------------------------------
// SDKSession interface
// ---------------------------------------------------------------------------

/**
 * A stateful session that holds conversation state across multiple sends.
 * Mirrors CC SDK's SDKSession interface for drop-in compatibility.
 */
export interface SDKSession {
  /** Unique identifier for this session. */
  readonly sessionId: string;

  /**
   * Send a message to the session. The session will process the message
   * through the query loop and yield results via `stream()`.
   */
  send(message: string | { role: 'user'; content: string }): Promise<void>;

  /**
   * Stream events from the session. Returns an async generator that yields
   * SDKMessage events as the session processes messages.
   */
  stream(): AsyncGenerator<SDKMessage, void, undefined>;

  /** Close the session and release resources. */
  close(): void;

  /** Interrupt the current query loop iteration. */
  interrupt(): Promise<void>;

  /** Change the model used for subsequent turns. */
  setModel(model: string | undefined): Promise<void>;

  /** Change the max thinking tokens for subsequent turns. */
  setMaxThinkingTokens(maxThinkingTokens: number | null): Promise<void>;

  /** Change the permission mode for subsequent turns. */
  setPermissionMode(mode: PermissionMode): Promise<void>;

  /** Async dispose support — calls close(). */
  [Symbol.asyncDispose](): Promise<void>;
}

// ---------------------------------------------------------------------------
// Internal session state
// ---------------------------------------------------------------------------

interface SessionState {
  sessionId: string;
  config: QueryConfig;
  provider: LlmProvider;
  tools: Tool[];
  messages: Message[];
  abortController: AbortController;
  closed: boolean;
  /** Queue of pending user messages. */
  pendingMessages: Array<string | Message>;
  /** Active stream generator (only one at a time). */
  activeStream: AsyncGenerator<SDKMessage, void, undefined> | null;
  /** External MCP connection (for cleanup on close). */
  externalMcp: ExternalMcpConnection | null;
  /** All MCP server connection statuses (SDK + external). */
  mcpServerStatuses: McpServerConnectionStatus[];
  /** Orchestrator handle (for sub-agent lifecycle). */
  orchestrator: OrchestratorHandle | null;
}

// ---------------------------------------------------------------------------
// createSession
// ---------------------------------------------------------------------------

/**
 * Create a new SDK session.
 *
 * The session maintains conversation state across multiple `send()` calls.
 * Use `stream()` to receive SDKMessage events.
 *
 * @param options - SDK Options for configuring the session
 * @returns A new SDKSession instance
 */
export async function createSession(options: Options): Promise<SDKSession> {
  const provider = options.provider;
  if (!provider) {
    throw new Error(
      'SDKSession requires a provider. Pass options.provider or use createProvider() to create one.',
    );
  }

  const config = resolveQueryConfig(options);
  const sessionId = options.sessionId ?? randomUUID();
  const abortController = options.abortController ?? new AbortController();

  // Build tool list:
  // 1. Start with built-in tools
  // 2. Merge customTools (custom overrides built-in by name)
  // 3. Bridge SDK MCP server tools (synchronous, in-process)
  // 4. Connect external MCP servers (async, stdio/sse/http)
  // 5. Apply allowedTools/disallowedTools filtering
  let tools: Tool[];
  if (options.customTools && options.customTools.length > 0) {
    const customToolNames = new Set(options.customTools.map((t) => t.name));
    const builtInTools = getAllTools().filter((t) => !customToolNames.has(t.name));
    tools = [...builtInTools, ...options.customTools];
  } else {
    tools = getAllTools();
  }

  // Bridge SDK MCP server tools into the tool list (synchronous)
  const mcpTools = extractSdkMcpTools(
    options.mcpServers as Record<string, unknown> | undefined,
  );
  if (mcpTools.length > 0) {
    const mcpToolNames = new Set(mcpTools.map((t) => t.name));
    tools = tools.filter((t) => !mcpToolNames.has(t.name));
    tools.push(...mcpTools);
  }

  // Collect MCP server statuses for the init message.
  // SDK (in-process) servers are always "connected".
  const mcpServerStatuses: McpServerConnectionStatus[] = [];
  if (options.mcpServers) {
    for (const [name, cfg] of Object.entries(options.mcpServers)) {
      if (cfg && typeof cfg === 'object' && (cfg as Record<string, unknown>).type === 'sdk') {
        mcpServerStatuses.push({ name, status: 'connected' });
      }
    }
  }

  // Connect external MCP servers (async — stdio/sse/http)
  let externalMcp: ExternalMcpConnection | null = null;
  try {
    externalMcp = await connectExternalMcpServers(
      options.mcpServers as Record<string, unknown> | undefined,
    );
    if (externalMcp.tools.length > 0) {
      const extToolNames = new Set(externalMcp.tools.map((t) => t.name));
      tools = tools.filter((t) => !extToolNames.has(t.name));
      tools.push(...externalMcp.tools);
    }
    // Merge external server statuses
    mcpServerStatuses.push(...externalMcp.serverStatuses);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[SDK] External MCP connection error: ${msg}`);
  }

  tools = filterTools(tools, {
    allowedTools: config.allowedTools,
    disallowedTools: config.disallowedTools,
  });

  // Initialize the orchestrator (wires AgentTool spawner + SendMessage router)
  const configWithSignal = { ...config, abortSignal: abortController.signal };
  const orchestrator = initOrchestrator({
    provider,
    config: configWithSignal,
    tools,
  });

  const state: SessionState = {
    sessionId,
    config: configWithSignal,
    provider,
    tools,
    messages: [],
    abortController,
    closed: false,
    pendingMessages: [],
    activeStream: null,
    externalMcp,
    mcpServerStatuses,
    orchestrator,
  };

  return createSessionProxy(state);
}

// ---------------------------------------------------------------------------
// Session proxy implementation
// ---------------------------------------------------------------------------

function createSessionProxy(state: SessionState): SDKSession {
  return {
    get sessionId(): string {
      return state.sessionId;
    },

    async send(message: string | { role: 'user'; content: string }): Promise<void> {
      if (state.closed) {
        throw new Error('Session is closed');
      }

      const text = typeof message === 'string' ? message : message.content;
      state.pendingMessages.push(text);
    },

    async *stream(): AsyncGenerator<SDKMessage, void, undefined> {
      if (state.closed) {
        throw new Error('Session is closed');
      }

      // If there are no pending messages, wait for one using an event-driven approach
      if (state.pendingMessages.length === 0 && !state.closed) {
        await new Promise<void>((resolve) => {
          const check = () => {
            if (state.pendingMessages.length > 0 || state.closed) {
              resolve();
            } else {
              setTimeout(check, 50);
            }
          };
          check();
        });
      }

      if (state.closed) return;

      // Drain all pending messages
      const pendingTexts: string[] = [];
      while (state.pendingMessages.length > 0) {
        const msg = state.pendingMessages.shift()!;
        pendingTexts.push(typeof msg === 'string' ? msg : String(msg));
      }

      // Combine pending messages into a single prompt
      const prompt = pendingTexts.join('\n\n');

      // Add the user message to session history BEFORE running the query loop
      const userMessage: Message = { role: 'user' as const, content: prompt };
      state.messages.push(userMessage);

      // Build the full conversation as initial messages for the query loop
      const initialMessages: Message[] = [...state.messages];

      // Track whether we've yielded the first init event
      const isFirstTurn = state.messages.length === 1;

      // Run the query loop, passing the session ID for consistent message session_id fields
      const queryOpts: QueryLoopOptions = {
        sessionId: state.sessionId,
        mcpServerStatuses: state.mcpServerStatuses.length > 0
          ? state.mcpServerStatuses
          : undefined,
      };
      const gen = queryLoop(
        state.config,
        state.provider,
        state.tools,
        initialMessages,
        queryOpts,
      );

      for await (const msg of gen) {
        if (state.closed) {
          gen.return(undefined);
          return;
        }

        // Track messages for session continuity
        if (msg.type === 'assistant') {
          state.messages.push(msg.message);
        } else if (msg.type === 'user') {
          // Tool result messages from the query loop
          state.messages.push(msg.message);
        }

        // Skip init events after the first send (the session already knows
        // its tools and model).
        if (msg.type === 'system' && msg.subtype === 'init' && !isFirstTurn) {
          continue;
        }

        yield msg;
      }
    },

    close(): void {
      if (!state.closed) {
        state.closed = true;
        state.abortController.abort();

        // Dispose orchestrator (abort sub-agents, reset stubs)
        if (state.orchestrator) {
          state.orchestrator.dispose();
          state.orchestrator = null;
        }

        // Disconnect external MCP servers
        if (state.externalMcp) {
          state.externalMcp.disconnect();
          state.externalMcp = null;
        }
      }
    },

    async interrupt(): Promise<void> {
      state.abortController.abort();
      // Create a new abort controller for subsequent interactions
      state.abortController = new AbortController();
      state.config = { ...state.config, abortSignal: state.abortController.signal };
    },

    async setModel(model: string | undefined): Promise<void> {
      if (model) {
        state.config = { ...state.config, model };
      }
    },

    async setMaxThinkingTokens(maxThinkingTokens: number | null): Promise<void> {
      if (maxThinkingTokens === null) {
        state.config = { ...state.config, thinking: { type: 'disabled' } };
      } else {
        state.config = {
          ...state.config,
          thinking: { type: 'enabled', budgetTokens: maxThinkingTokens },
        };
      }
    },

    async setPermissionMode(_mode: PermissionMode): Promise<void> {
      // Permission mode is handled by the canUseTool callback.
      // The SDK preserves the callback interface.
    },

    async [Symbol.asyncDispose](): Promise<void> {
      this.close();
    },
  };
}
