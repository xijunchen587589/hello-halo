/**
 * Security Policy — centralized, build-time-gated security toggles sourced
 * from product.json.
 *
 * Naming convention: every flag is `<surface>Safe: boolean`.
 *   - `true`  → safe mode ON, restrictions enforced
 *   - omitted / `false` → permissive default (open-source friendly)
 *
 * The flags exist so an enterprise variant (e.g. product.webank.json) can
 * harden specific attack surfaces without forking the codebase. Open-source
 * builds that omit the `security` block keep every default behavior intact.
 *
 * Adding a new policy flag:
 *   1. Extend `SecurityPolicy` below
 *   2. Add a matching property under `security` in product.schema.json
 *   3. Export a typed predicate (e.g. `isXxxSafe()`)
 *   4. Wire the predicate at the protected surface, ideally via a small
 *      `rejectIfXxxForbidden()` helper that owns the response shape so
 *      consumers stay one-liners.
 */
import type { Response } from 'express'
import { parse as parseYaml } from 'yaml'

import { loadProductConfig } from './ai-sources/auth-loader'

// ============================================================================
// Policy shape
// ============================================================================

export interface SecurityPolicy {
  /**
   * When true, every remote HTTP entry point that could land an MCP server
   * configuration returns 403. Covers:
   *   - POST /api/apps/install (AppSpec where type === 'mcp')
   *   - POST /api/apps/import-spec (YAML AppSpec where type === 'mcp')
   *   - PATCH /api/apps/:appId/spec (patch touches mcp_server OR target
   *     app is already type === 'mcp')
   *   - POST /api/config (body touches mcpServers map)
   *   - POST /api/store/install + POST /api/store/apps/:slug/install
   *     (resolved store spec is type === 'mcp')
   *
   * Local IPC install paths are unaffected — users can still add MCP
   * servers from the desktop UI where they can review the command before
   * it lands.
   *
   * Rationale: stdio MCP servers spawn arbitrary native processes with
   * the user's privileges. A remote caller cannot review the command and
   * cannot be shown a confirmation dialog, so the only safe posture for
   * a managed enterprise deployment is to require a local-UI install.
   */
  remoteMcpSafe?: boolean

  /**
   * Encrypts the persisted remote-access credential at rest with
   * SM4-CBC + HMAC-SM3 (encrypt-then-MAC; GM/T 0002 + GM/T 0091) under a
   * machine-bound KEK. Off by default — open-source builds store the
   * credential as plain text exactly as before. The plaintext is held in
   * memory in both modes so the UI can keep displaying the current PIN
   * and validation runs `crypto.timingSafeEqual` against the in-memory
   * value.
   */
  credentialAtRestSafe?: boolean

  /**
   * When true, the Cloudflare Quick Tunnel feature is disabled at every
   * layer:
   *   - Service: `startTunnel()` short-circuits and never spawns
   *     `cloudflared`.
   *   - IPC: `remote:tunnel:enable` / `remote:tunnel:disable` reject
   *     before touching the service.
   *   - UI: the "Internet Access" subsection in Remote Access settings
   *     and the Cloudflared row in System Diagnostics do not render.
   *
   * Rationale: a managed enterprise deployment may forbid outbound HTTPS
   * tunnels that expose the workstation's HTTP server to the public
   * internet without going through the corporate proxy / IdP.
   *
   * Consumers live under `src/main/services/tunnel.service.ts`,
   * `src/main/services/remote.service.ts`, `src/main/ipc/remote.ts`, and
   * the renderer hook `useSecurityPolicy`.
   */
  tunnelSafe?: boolean
}

/**
 * Subset of {@link SecurityPolicy} that is safe to expose to the renderer
 * process. The renderer needs policy flags to gate UI surfaces, but it
 * MUST NOT receive anything that leaks deployment topology or secrets.
 *
 * Every field is a plain boolean and the shape is closed (no
 * passthrough). Adding a field here is an explicit decision — see
 * `getPublicSecurityPolicy()`.
 */
export interface PublicSecurityPolicy {
  tunnelSafe: boolean
}

// ============================================================================
// Policy accessors
// ============================================================================

export function getSecurityPolicy(): SecurityPolicy {
  // ProductConfig.security is typed as Record<string, unknown> to keep the
  // auth-loader free of a circular import. Re-narrow at the boundary here
  // so every consumer sees a typed SecurityPolicy.
  return (loadProductConfig().security ?? {}) as SecurityPolicy
}

export function isRemoteMcpSafe(): boolean {
  return getSecurityPolicy().remoteMcpSafe === true
}

/**
 * True only when `credentialAtRestSafe` is explicitly set to boolean true.
 *
 * Consumers MUST treat this as a one-way gate: when false, the credential
 * persistence layer takes the standard path (plain string stored in
 * config). When true, the GM/T path is taken: HKDF-SHA-256 over a
 * machine-bound seed derives an SM4-CBC encryption key and an HMAC-SM3
 * MAC key (encrypt-then-MAC); see `src/main/http/auth/envelope.ts`. Any
 * non-boolean truthy value is treated as false to prevent accidental
 * enablement via config typos.
 */
export function isCredentialAtRestSafe(): boolean {
  return getSecurityPolicy().credentialAtRestSafe === true
}

/**
 * True only when `tunnelSafe` is explicitly set to boolean true.
 *
 * Any non-boolean truthy value is treated as false to prevent accidental
 * enablement via config typos (matches the convention used by every
 * other `<surface>Safe` predicate).
 */
export function isTunnelSafe(): boolean {
  return getSecurityPolicy().tunnelSafe === true
}

/**
 * Build the renderer-safe slice of the security policy.
 *
 * Keep this function as the single point of truth for what the renderer
 * is allowed to see — if a new field is added to {@link SecurityPolicy}
 * but not to {@link PublicSecurityPolicy} it stays main-process only.
 */
export function getPublicSecurityPolicy(): PublicSecurityPolicy {
  return {
    tunnelSafe: isTunnelSafe(),
  }
}

// ============================================================================
// MCP detection helpers
// ============================================================================

/**
 * Returns true when the value looks like an AppSpec for type=mcp.
 * Used by /api/apps/install before forwarding to the manager.
 */
export function isMcpAppSpec(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { type?: unknown }).type === 'mcp'
  )
}

/**
 * Returns true when a JSON Merge Patch body touches MCP-specific fields.
 * Used by PATCH /api/apps/:appId/spec to detect attempts to (re)write
 * mcp_server.command/args/env/cwd.
 */
export function patchTouchesMcp(patch: unknown): boolean {
  if (typeof patch !== 'object' || patch === null) return false
  const p = patch as Record<string, unknown>
  return p.type === 'mcp' || 'mcp_server' in p
}

/**
 * Returns true when a config-update body touches the legacy `mcpServers`
 * map (Cursor / Claude Desktop compatible format stored in config.json).
 * Used by POST /api/config — that endpoint can land MCP server entries
 * outside the App spec system.
 */
export function configTouchesMcp(body: unknown): boolean {
  if (typeof body !== 'object' || body === null) return false
  return 'mcpServers' in (body as Record<string, unknown>)
}

/**
 * Best-effort YAML peek used by POST /api/apps/import-spec. Returns true
 * when the parsed document is an AppSpec for type=mcp. Returns false on
 * any parse error — let the controller surface the real INVALID_YAML
 * status, this helper exists only to short-circuit MCP installs.
 */
export function yamlIsMcpSpec(yamlContent: string): boolean {
  try {
    return isMcpAppSpec(parseYaml(yamlContent))
  } catch {
    return false
  }
}

// ============================================================================
// Enforcement helper
// ============================================================================

/** Stable error code so clients can render a localized message. */
export const MCP_REMOTE_INSTALL_FORBIDDEN = 'MCP_REMOTE_INSTALL_FORBIDDEN'

const MCP_REMOTE_INSTALL_FORBIDDEN_MESSAGE =
  'Remote MCP configuration is disabled by security policy. Install MCP servers from the local Halo app.'

function writeMcpForbiddenResponse(res: Response, surface: string): void {
  console.warn(`[SecurityPolicy] Blocked remote MCP write at ${surface} (remoteMcpSafe=true)`)
  res.status(403).json({
    success: false,
    error: MCP_REMOTE_INSTALL_FORBIDDEN_MESSAGE,
    code: MCP_REMOTE_INSTALL_FORBIDDEN,
  })
}

/**
 * Reject the request with 403 when remote-MCP-safe mode is on AND the
 * given predicate confirms the payload touches MCP. Returns true when the
 * request was rejected (caller MUST return immediately). Returns false
 * when the caller may proceed.
 *
 * The predicate is invoked lazily so that the (default) permissive build
 * pays zero cost — no peeking, no parsing — when the flag is off.
 */
export function rejectIfRemoteMcpForbidden(
  res: Response,
  touchesMcp: () => boolean,
  surface: string,
): boolean {
  if (!isRemoteMcpSafe()) return false
  if (!touchesMcp()) return false
  writeMcpForbiddenResponse(res, surface)
  return true
}

/**
 * Async variant for callers that need an awaited lookup (e.g. fetching a
 * store entry's spec) to know whether the payload touches MCP. Same lazy
 * semantics: the resolver is only called when remoteMcpSafe is on.
 */
export async function rejectIfRemoteMcpForbiddenAsync(
  res: Response,
  touchesMcp: () => Promise<boolean>,
  surface: string,
): Promise<boolean> {
  if (!isRemoteMcpSafe()) return false
  if (!(await touchesMcp())) return false
  writeMcpForbiddenResponse(res, surface)
  return true
}

// ============================================================================
// Tunnel policy
// ============================================================================

/**
 * Stable error code returned at every tunnel layer (service / IPC) when
 * the tunnel feature is disabled by `security.tunnelSafe`. Clients can
 * match on this code to render a localized hint without depending on the
 * English message string.
 */
export const TUNNEL_DISABLED_BY_POLICY = 'TUNNEL_DISABLED_BY_POLICY'

/** Human-readable message paired with {@link TUNNEL_DISABLED_BY_POLICY}. */
export const TUNNEL_DISABLED_BY_POLICY_MESSAGE =
  'Cloudflare Tunnel is disabled by security policy in this build.'
