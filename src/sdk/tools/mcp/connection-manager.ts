/**
 * @module tools/mcp/connection-manager
 * MCP Connection Manager — manages lifecycle (connect / disconnect / reconnect)
 * for a set of external MCP servers.
 *
 * Features:
 *   - Per-server status tracking (Connected, Connecting, Disconnected, Failed)
 *   - Exponential-backoff reconnection loops (1s → 2s → 4s → … capped at 60s)
 *   - Connect / disconnect / restart control plane
 *   - Tool-call-level reconnection: if a tool call fails because the transport
 *     disconnected, the manager attempts a single reconnect before returning error
 *
 * @license MIT
 */

import type { Tool, ToolResult, ToolContext } from '../../types/tool.js';
import { McpClient, type McpToolDefinition } from './client.js';
import { StdioTransport, SSETransport, HttpTransport } from './transports.js';
import type { McpTransport } from './jsonrpc.js';
import type { McpServerConnectionStatus } from './bridge.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 60_000;
const BACKOFF_MULTIPLIER = 2;

// ---------------------------------------------------------------------------
// Status types
// ---------------------------------------------------------------------------

/** Live connection status for a single MCP server. */
export type McpServerLiveStatus =
  | { state: 'connected'; toolCount: number }
  | { state: 'connecting' }
  | { state: 'disconnected'; lastError?: string }
  | { state: 'failed'; error: string; retryAt: number };

// ---------------------------------------------------------------------------
// Internal per-server state
// ---------------------------------------------------------------------------

interface ServerEntry {
  name: string;
  config: Record<string, unknown>;
  status: McpServerLiveStatus;
  client: McpClient | null;
  transport: McpTransport | null;
  tools: McpToolDefinition[];
  /** Handle returned by setTimeout for the reconnect loop. */
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  /** Current backoff duration in ms. */
  backoffMs: number;
  /** Whether the reconnect loop is running. */
  reconnecting: boolean;
}

// ---------------------------------------------------------------------------
// McpConnectionManager
// ---------------------------------------------------------------------------

/**
 * Manages lifecycle for a set of external MCP servers.
 *
 * Usage:
 * ```ts
 * const mgr = new McpConnectionManager();
 * mgr.addServer('my-db', { type: 'stdio', command: 'my-mcp-server' });
 * await mgr.connectAll();
 *
 * const tools = mgr.getBridgedTools(); // Tool[] for the query loop
 * const statuses = mgr.getStatuses();  // for init message
 *
 * // On session close:
 * mgr.disconnectAll();
 * ```
 */
export class McpConnectionManager {
  private servers = new Map<string, ServerEntry>();
  private _disposed = false;

  // -------------------------------------------------------------------------
  // Server registration
  // -------------------------------------------------------------------------

  /**
   * Register a server config. Does not connect yet.
   */
  addServer(name: string, config: Record<string, unknown>): void {
    if (this.servers.has(name)) return; // idempotent
    this.servers.set(name, {
      name,
      config,
      status: { state: 'disconnected' },
      client: null,
      transport: null,
      tools: [],
      reconnectTimer: null,
      backoffMs: INITIAL_BACKOFF_MS,
      reconnecting: false,
    });
  }

  // -------------------------------------------------------------------------
  // Connect / disconnect / restart
  // -------------------------------------------------------------------------

  /**
   * Connect all registered servers. Errors are non-fatal per server.
   */
  async connectAll(): Promise<void> {
    const promises = Array.from(this.servers.keys()).map((name) =>
      this.connect(name).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[MCP] Server "${name}" failed to connect: ${msg}`);
      }),
    );
    await Promise.all(promises);
  }

  /**
   * Connect to a single server by name.
   */
  async connect(name: string): Promise<void> {
    const entry = this.servers.get(name);
    if (!entry) throw new Error(`Unknown MCP server: ${name}`);

    entry.status = { state: 'connecting' };

    try {
      const transport = createTransport(entry.name, entry.config);
      if (!transport) {
        entry.status = { state: 'disconnected', lastError: 'unsupported transport type' };
        return;
      }

      await transport.connect();

      const client = new McpClient(transport, entry.name);
      await client.initialize();

      entry.transport = transport;
      entry.client = client;
      entry.tools = client.getTools();
      entry.status = { state: 'connected', toolCount: entry.tools.length };
      entry.backoffMs = INITIAL_BACKOFF_MS; // reset on success
      entry.reconnecting = false;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      entry.client = null;
      entry.transport = null;
      entry.tools = [];
      entry.status = { state: 'disconnected', lastError: msg };
      throw err;
    }
  }

  /**
   * Disconnect a single server and cancel its reconnect loop.
   */
  disconnect(name: string): void {
    const entry = this.servers.get(name);
    if (!entry) return;

    this.cancelReconnect(entry);

    if (entry.client) {
      try { entry.client.close(); } catch { /* ignore close errors */ }
      entry.client = null;
    }
    entry.transport = null;
    entry.tools = [];
    entry.status = { state: 'disconnected' };
  }

  /**
   * Disconnect all servers and release all resources.
   */
  disconnectAll(): void {
    this._disposed = true;
    for (const name of this.servers.keys()) {
      this.disconnect(name);
    }
  }

  /**
   * Disconnect then reconnect a server.
   */
  async restart(name: string): Promise<void> {
    this.disconnect(name);
    await this.connect(name);
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  /**
   * Get the live status for a single server.
   */
  getStatus(name: string): McpServerLiveStatus | undefined {
    return this.servers.get(name)?.status;
  }

  /**
   * Get statuses for all servers.
   */
  getAllStatuses(): Map<string, McpServerLiveStatus> {
    const map = new Map<string, McpServerLiveStatus>();
    for (const [name, entry] of this.servers) {
      map.set(name, entry.status);
    }
    return map;
  }

  /**
   * Get connection statuses for the init message.
   */
  getStatuses(): McpServerConnectionStatus[] {
    const result: McpServerConnectionStatus[] = [];
    for (const [name, entry] of this.servers) {
      if (entry.status.state === 'connected') {
        result.push({ name, status: 'connected' });
      } else {
        const error = entry.status.state === 'disconnected'
          ? entry.status.lastError
          : entry.status.state === 'failed'
            ? entry.status.error
            : undefined;
        result.push({ name, status: 'failed', error });
      }
    }
    return result;
  }

  /**
   * Whether a server is currently connected.
   */
  isConnected(name: string): boolean {
    const entry = this.servers.get(name);
    return entry?.status.state === 'connected' && entry.client != null;
  }

  /**
   * Names of all registered servers.
   */
  serverNames(): string[] {
    return Array.from(this.servers.keys());
  }

  // -------------------------------------------------------------------------
  // Tool bridging
  // -------------------------------------------------------------------------

  /**
   * Return all tools from all connected servers as SDK `Tool[]` objects
   * suitable for the query loop.
   *
   * Tools are wrapped with auto-reconnect: if a call fails due to a
   * disconnected transport, the manager attempts a single reconnect
   * before returning the error.
   */
  getBridgedTools(): Tool[] {
    const allTools: Tool[] = [];
    for (const [, entry] of this.servers) {
      if (entry.status.state !== 'connected' || !entry.client) continue;

      for (const mcpTool of entry.tools) {
        allTools.push(this.createBridgedTool(entry.name, mcpTool));
      }
    }
    return allTools;
  }

  /**
   * Create a single bridged Tool that routes to the MCP server and
   * includes auto-reconnect logic.
   */
  private createBridgedTool(
    serverName: string,
    mcpTool: McpToolDefinition,
  ): Tool {
    const fullName = `mcp__${serverName}__${mcpTool.name}`;
    const manager = this;

    return {
      name: fullName,
      description: mcpTool.description,
      inputSchema: mcpTool.inputSchema,
      permissionLevel: 'execute' as const,

      async execute(
        input: Record<string, unknown>,
        _ctx: ToolContext,
      ): Promise<ToolResult> {
        const entry = manager.servers.get(serverName);
        if (!entry) {
          return {
            content: `MCP server "${serverName}" not found.`,
            isError: true,
          };
        }

        // Attempt tool call
        let result = await manager.attemptToolCall(entry, mcpTool.name, input);

        // If the call failed due to disconnection, attempt one reconnect
        if (result.isError && manager.isTransportDead(entry)) {
          console.warn(
            `[MCP] Server "${serverName}" disconnected during tool call "${mcpTool.name}"; attempting reconnect…`,
          );

          const reconnected = await manager.tryReconnect(entry);
          if (reconnected) {
            // Retry the tool call after successful reconnect
            result = await manager.attemptToolCall(entry, mcpTool.name, input);
          } else {
            // Start background reconnect loop for future calls
            manager.startReconnectLoop(serverName);
          }
        }

        return result;
      },
    };
  }

  /**
   * Attempt a single tool call on a server entry.
   */
  private async attemptToolCall(
    entry: ServerEntry,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<ToolResult> {
    if (!entry.client) {
      return {
        content: `MCP server "${entry.name}" is not connected.`,
        isError: true,
      };
    }

    try {
      const result = await entry.client.callTool(toolName, args);
      return formatCallToolResult(result.content, result.isError);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        content: `MCP tool error (${entry.name}/${toolName}): ${msg}`,
        isError: true,
      };
    }
  }

  /**
   * Check if the transport for a server is dead (disconnected/closed).
   */
  private isTransportDead(entry: ServerEntry): boolean {
    if (!entry.transport) return true;
    return !entry.transport.connected;
  }

  /**
   * Attempt to reconnect a single server (synchronous single attempt).
   * Returns true if reconnection succeeded.
   */
  private async tryReconnect(entry: ServerEntry): Promise<boolean> {
    // Close existing transport
    if (entry.client) {
      try { entry.client.close(); } catch { /* ignore */ }
    }
    entry.client = null;
    entry.transport = null;

    try {
      const transport = createTransport(entry.name, entry.config);
      if (!transport) return false;

      await transport.connect();

      const client = new McpClient(transport, entry.name);
      await client.initialize();

      entry.transport = transport;
      entry.client = client;
      entry.tools = client.getTools();
      entry.status = { state: 'connected', toolCount: entry.tools.length };
      entry.backoffMs = INITIAL_BACKOFF_MS;
      entry.reconnecting = false;

      console.info(`[MCP] Server "${entry.name}" reconnected (${entry.tools.length} tools).`);
      return true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      entry.status = { state: 'disconnected', lastError: msg };
      console.warn(`[MCP] Reconnect to "${entry.name}" failed: ${msg}`);
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // Background reconnection loop
  // -------------------------------------------------------------------------

  /**
   * Start a background exponential-backoff reconnection loop for a server.
   * The loop exits when the server connects successfully or is disconnected
   * explicitly (i.e., manager.disconnect() is called).
   *
   * Backoff: 1s → 2s → 4s → … capped at 60s.
   */
  startReconnectLoop(name: string): void {
    const entry = this.servers.get(name);
    if (!entry) return;

    // Don't start a second loop
    if (entry.reconnecting) return;
    entry.reconnecting = true;

    this.scheduleReconnectAttempt(entry);
  }

  /**
   * Schedule the next reconnect attempt for a server.
   */
  private scheduleReconnectAttempt(entry: ServerEntry): void {
    if (this._disposed) return;

    const retryAt = Date.now() + entry.backoffMs;

    // Update status to reflect the pending retry
    const prevError = entry.status.state === 'disconnected'
      ? (entry.status.lastError ?? 'connection lost')
      : entry.status.state === 'failed'
        ? entry.status.error
        : 'connection lost';

    entry.status = {
      state: 'failed',
      error: prevError,
      retryAt,
    };

    entry.reconnectTimer = setTimeout(async () => {
      if (this._disposed || !entry.reconnecting) return;

      entry.status = { state: 'connecting' };

      const success = await this.tryReconnect(entry);
      if (success) {
        entry.reconnecting = false;
        return;
      }

      // Exponential backoff
      entry.backoffMs = Math.min(
        entry.backoffMs * BACKOFF_MULTIPLIER,
        MAX_BACKOFF_MS,
      );

      // Schedule next attempt
      if (entry.reconnecting && !this._disposed) {
        this.scheduleReconnectAttempt(entry);
      }
    }, entry.backoffMs);
  }

  /**
   * Cancel the reconnect loop for a server.
   */
  private cancelReconnect(entry: ServerEntry): void {
    entry.reconnecting = false;
    if (entry.reconnectTimer != null) {
      clearTimeout(entry.reconnectTimer);
      entry.reconnectTimer = null;
    }
  }
}

// ---------------------------------------------------------------------------
// Transport factory
// ---------------------------------------------------------------------------

/**
 * Create a transport from a server config record.
 * Returns null for unsupported or invalid configs.
 */
function createTransport(
  name: string,
  config: Record<string, unknown>,
): McpTransport | null {
  const type = (config.type as string | undefined) ?? 'stdio';

  switch (type) {
    case 'stdio': {
      const command = config.command as string | undefined;
      if (!command) {
        console.warn(`[MCP] Server "${name}" has type=stdio but no command`);
        return null;
      }
      return new StdioTransport({
        command,
        args: config.args as string[] | undefined,
        env: config.env as Record<string, string> | undefined,
        cwd: config.cwd as string | undefined,
      });
    }

    case 'sse': {
      const url = config.url as string | undefined;
      if (!url) {
        console.warn(`[MCP] Server "${name}" has type=sse but no url`);
        return null;
      }
      return new SSETransport({
        url,
        headers: config.headers as Record<string, string> | undefined,
      });
    }

    case 'http': {
      const url = config.url as string | undefined;
      if (!url) {
        console.warn(`[MCP] Server "${name}" has type=http but no url`);
        return null;
      }
      return new HttpTransport({
        url,
        headers: config.headers as Record<string, string> | undefined,
      });
    }

    default:
      console.warn(`[MCP] Unsupported transport type "${type}" for server "${name}"`);
      return null;
  }
}

// ---------------------------------------------------------------------------
// Shared helpers (duplicated from bridge.ts to avoid circular deps)
// ---------------------------------------------------------------------------

/**
 * Convert MCP CallToolResult content blocks to a ToolResult.
 */
function formatCallToolResult(
  content: Array<{ type: string; [key: string]: unknown }>,
  isError?: boolean,
): ToolResult {
  const textParts: string[] = [];
  for (const block of content) {
    if (block.type === 'text' && typeof block.text === 'string') {
      textParts.push(block.text);
    } else if (block.type === 'image') {
      textParts.push(`[Image: ${(block.mimeType as string) ?? 'unknown'}]`);
    } else {
      textParts.push(JSON.stringify(block));
    }
  }

  return {
    content: textParts.join('\n'),
    isError: isError ?? false,
  };
}

// ---------------------------------------------------------------------------
// Factory helper
// ---------------------------------------------------------------------------

/**
 * Create a McpConnectionManager from an mcpServers config record,
 * skipping SDK-type configs (those are handled in-process).
 *
 * @param mcpServers - The mcpServers record from Options
 * @returns A new McpConnectionManager with all external servers registered
 */
export function createMcpConnectionManager(
  mcpServers: Record<string, unknown> | undefined,
): McpConnectionManager {
  const mgr = new McpConnectionManager();
  if (!mcpServers) return mgr;

  for (const [name, config] of Object.entries(mcpServers)) {
    if (!config || typeof config !== 'object') continue;
    const cfg = config as Record<string, unknown>;
    // Skip SDK-type configs — handled by extractSdkMcpTools()
    if (cfg.type === 'sdk') continue;
    mgr.addServer(name, cfg);
  }

  return mgr;
}
