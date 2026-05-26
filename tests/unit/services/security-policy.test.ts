/**
 * Security Policy Unit Tests
 *
 * Covers the centralized security-policy module: detection helpers,
 * sync/async rejection helpers, and the default-permissive behavior that
 * keeps open-source builds unaffected.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock the product config loader so each test controls the security block.
vi.mock('../../../src/main/services/ai-sources/auth-loader', () => ({
  loadProductConfig: vi.fn(),
}))

import { loadProductConfig } from '../../../src/main/services/ai-sources/auth-loader'
import {
  isRemoteMcpSafe,
  isCredentialAtRestSafe,
  getSecurityPolicy,
  isMcpAppSpec,
  patchTouchesMcp,
  configTouchesMcp,
  yamlIsMcpSpec,
  rejectIfRemoteMcpForbidden,
  rejectIfRemoteMcpForbiddenAsync,
  MCP_REMOTE_INSTALL_FORBIDDEN,
} from '../../../src/main/services/security-policy'

type MockedLoader = ReturnType<typeof vi.fn>

function setProductConfig(security?: Record<string, unknown>): void {
  ;(loadProductConfig as unknown as MockedLoader).mockReturnValue({
    name: 'test',
    version: '0.0.0',
    authProviders: [],
    ...(security !== undefined ? { security } : {}),
  })
}

function makeRes(): { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> } {
  const json = vi.fn()
  const status = vi.fn(() => ({ json }))
  return { status: status as unknown as ReturnType<typeof vi.fn>, json }
}

describe('security-policy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // --------------------------------------------------------------------------
  // Policy accessors — default permissive behavior
  // --------------------------------------------------------------------------

  describe('getSecurityPolicy / isRemoteMcpSafe', () => {
    it('returns empty policy when product.json omits security (open-source default)', () => {
      setProductConfig(undefined)
      expect(getSecurityPolicy()).toEqual({})
      expect(isRemoteMcpSafe()).toBe(false)
    })

    it('returns false when remoteMcpSafe is explicitly false', () => {
      setProductConfig({ remoteMcpSafe: false })
      expect(isRemoteMcpSafe()).toBe(false)
    })

    it('returns true only when remoteMcpSafe === true (enterprise opt-in)', () => {
      setProductConfig({ remoteMcpSafe: true })
      expect(isRemoteMcpSafe()).toBe(true)
    })

    it('ignores non-boolean truthy values to avoid accidental enablement', () => {
      setProductConfig({ remoteMcpSafe: 1 as unknown as boolean })
      expect(isRemoteMcpSafe()).toBe(false)
    })
  })

  describe('isCredentialAtRestSafe', () => {
    it('returns false when product.json omits security (open-source default)', () => {
      setProductConfig(undefined)
      expect(isCredentialAtRestSafe()).toBe(false)
    })

    it('returns false when credentialAtRestSafe is explicitly false', () => {
      setProductConfig({ credentialAtRestSafe: false })
      expect(isCredentialAtRestSafe()).toBe(false)
    })

    it('returns true only when credentialAtRestSafe === true (enterprise opt-in)', () => {
      setProductConfig({ credentialAtRestSafe: true })
      expect(isCredentialAtRestSafe()).toBe(true)
    })

    it('ignores non-boolean truthy values to avoid accidental enablement', () => {
      setProductConfig({ credentialAtRestSafe: 1 as unknown as boolean })
      expect(isCredentialAtRestSafe()).toBe(false)
    })

    it('is independent from other policy flags (orthogonal surfaces)', () => {
      setProductConfig({ remoteMcpSafe: true })
      expect(isCredentialAtRestSafe()).toBe(false)
      setProductConfig({ credentialAtRestSafe: true })
      expect(isRemoteMcpSafe()).toBe(false)
    })
  })

  // --------------------------------------------------------------------------
  // Detection helpers
  // --------------------------------------------------------------------------

  describe('isMcpAppSpec', () => {
    it('matches spec where type === "mcp"', () => {
      expect(isMcpAppSpec({ type: 'mcp', name: 'x', mcp_server: { command: 'cmd' } })).toBe(true)
    })
    it('rejects automation/skill/extension specs', () => {
      expect(isMcpAppSpec({ type: 'automation' })).toBe(false)
      expect(isMcpAppSpec({ type: 'skill' })).toBe(false)
      expect(isMcpAppSpec({ type: 'extension' })).toBe(false)
    })
    it('rejects malformed inputs without throwing', () => {
      expect(isMcpAppSpec(null)).toBe(false)
      expect(isMcpAppSpec(undefined)).toBe(false)
      expect(isMcpAppSpec('mcp')).toBe(false)
      expect(isMcpAppSpec(42)).toBe(false)
      expect(isMcpAppSpec({})).toBe(false)
    })
  })

  describe('patchTouchesMcp', () => {
    it('matches a patch that sets type to mcp', () => {
      expect(patchTouchesMcp({ type: 'mcp' })).toBe(true)
    })
    it('matches a patch that includes mcp_server (even with null value, to catch deletions)', () => {
      expect(patchTouchesMcp({ mcp_server: { command: 'evil' } })).toBe(true)
      expect(patchTouchesMcp({ mcp_server: null })).toBe(true)
    })
    it('ignores patches that touch unrelated fields', () => {
      expect(patchTouchesMcp({ name: 'renamed' })).toBe(false)
      expect(patchTouchesMcp({ description: '...' })).toBe(false)
    })
    it('rejects malformed inputs without throwing', () => {
      expect(patchTouchesMcp(null)).toBe(false)
      expect(patchTouchesMcp('mcp_server')).toBe(false)
    })
  })

  describe('configTouchesMcp', () => {
    it('matches a config body that updates mcpServers map', () => {
      expect(configTouchesMcp({ mcpServers: { foo: { command: 'cmd' } } })).toBe(true)
      expect(configTouchesMcp({ mcpServers: {} })).toBe(true)
    })
    it('ignores unrelated config updates', () => {
      expect(configTouchesMcp({ remoteAccess: { enabled: true } })).toBe(false)
      expect(configTouchesMcp({})).toBe(false)
    })
  })

  describe('yamlIsMcpSpec', () => {
    it('detects MCP type in YAML', () => {
      expect(yamlIsMcpSpec('type: mcp\nname: foo\nmcp_server:\n  command: cmd')).toBe(true)
    })
    it('returns false for non-MCP YAML', () => {
      expect(yamlIsMcpSpec('type: automation\nname: foo')).toBe(false)
    })
    it('returns false for malformed YAML (controller surfaces the real error)', () => {
      expect(yamlIsMcpSpec(':::not-yaml:::\n  - [')).toBe(false)
    })
  })

  // --------------------------------------------------------------------------
  // Sync rejection helper
  // --------------------------------------------------------------------------

  describe('rejectIfRemoteMcpForbidden', () => {
    it('returns false and never calls the predicate when policy is off', () => {
      setProductConfig(undefined)
      const res = makeRes()
      const predicate = vi.fn(() => true)
      const blocked = rejectIfRemoteMcpForbidden(res as never, predicate, 'TEST')
      expect(blocked).toBe(false)
      expect(predicate).not.toHaveBeenCalled()
      expect(res.status).not.toHaveBeenCalled()
    })

    it('returns false when policy is on but payload does not touch MCP', () => {
      setProductConfig({ remoteMcpSafe: true })
      const res = makeRes()
      const blocked = rejectIfRemoteMcpForbidden(res as never, () => false, 'TEST')
      expect(blocked).toBe(false)
      expect(res.status).not.toHaveBeenCalled()
    })

    it('returns true and writes 403 with stable error code when blocked', () => {
      setProductConfig({ remoteMcpSafe: true })
      const res = makeRes()
      const blocked = rejectIfRemoteMcpForbidden(res as never, () => true, 'POST /api/apps/install')
      expect(blocked).toBe(true)
      expect(res.status).toHaveBeenCalledWith(403)
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          code: MCP_REMOTE_INSTALL_FORBIDDEN,
        }),
      )
    })
  })

  // --------------------------------------------------------------------------
  // Async rejection helper (used by store install paths)
  // --------------------------------------------------------------------------

  describe('rejectIfRemoteMcpForbiddenAsync', () => {
    it('skips the async predicate when policy is off (zero-cost on open-source)', async () => {
      setProductConfig(undefined)
      const res = makeRes()
      const predicate = vi.fn(async () => true)
      const blocked = await rejectIfRemoteMcpForbiddenAsync(res as never, predicate, 'TEST')
      expect(blocked).toBe(false)
      expect(predicate).not.toHaveBeenCalled()
    })

    it('awaits the predicate and blocks when it resolves true', async () => {
      setProductConfig({ remoteMcpSafe: true })
      const res = makeRes()
      const blocked = await rejectIfRemoteMcpForbiddenAsync(
        res as never,
        async () => true,
        'POST /api/store/install',
      )
      expect(blocked).toBe(true)
      expect(res.status).toHaveBeenCalledWith(403)
    })

    it('lets the request proceed when the predicate resolves false', async () => {
      setProductConfig({ remoteMcpSafe: true })
      const res = makeRes()
      const blocked = await rejectIfRemoteMcpForbiddenAsync(
        res as never,
        async () => false,
        'POST /api/store/install',
      )
      expect(blocked).toBe(false)
      expect(res.status).not.toHaveBeenCalled()
    })
  })
})
