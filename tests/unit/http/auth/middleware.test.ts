/**
 * Auth middleware tests. Covers the `/api/*` gate, the public-path
 * allowlist, and bearer/query token extraction. The login handler is
 * exercised via rate-limit.test.ts and audit/alert behavior.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Request, Response, NextFunction } from 'express'

vi.mock('../../../../src/main/services/security-policy', () => ({
  isCredentialAtRestSafe: vi.fn(() => false),
}))

import { authMiddleware } from '../../../../src/main/http/auth/middleware'
import {
  setCustomAccessToken,
  clearAccessToken,
} from '../../../../src/main/http/auth/token-store'

interface MockResponse {
  statusCode: number
  body: unknown
  status(code: number): MockResponse
  json(payload: unknown): MockResponse
}

function makeRes(): MockResponse {
  const res: MockResponse = {
    statusCode: 200,
    body: null,
    status(code: number) {
      this.statusCode = code
      return this
    },
    json(payload: unknown) {
      this.body = payload
      return this
    },
  }
  return res
}

function makeReq(path: string, init: Partial<Request> = {}): Request {
  return {
    path,
    headers: init.headers ?? {},
    query: init.query ?? {},
  } as unknown as Request
}

function run(req: Request): { nextCalled: boolean; res: MockResponse } {
  const res = makeRes()
  let nextCalled = false
  const next: NextFunction = () => {
    nextCalled = true
  }
  authMiddleware(req, res as unknown as Response, next)
  return { nextCalled, res }
}

describe('authMiddleware', () => {
  beforeEach(() => {
    clearAccessToken()
    setCustomAccessToken('Aa1!Aa1!')
  })

  describe('public paths', () => {
    it('allows /api/remote/login without a token', () => {
      const { nextCalled } = run(makeReq('/api/remote/login'))
      expect(nextCalled).toBe(true)
    })

    it('allows /api/remote/status without a token', () => {
      const { nextCalled } = run(makeReq('/api/remote/status'))
      expect(nextCalled).toBe(true)
    })

    it('allows /api/security/policy without a token (renderer needs it pre-login)', () => {
      const { nextCalled } = run(makeReq('/api/security/policy'))
      expect(nextCalled).toBe(true)
    })

    it('allows static asset paths without a token', () => {
      expect(run(makeReq('/assets/app.js')).nextCalled).toBe(true)
      expect(run(makeReq('/main.css')).nextCalled).toBe(true)
      expect(run(makeReq('/favicon.ico')).nextCalled).toBe(true)
    })
  })

  describe('/api/* never bypasses by suffix (regression: .json suffix would skip auth)', () => {
    it('rejects /api/config.json without a token even though the path ends in .json', () => {
      const { nextCalled, res } = run(makeReq('/api/config.json'))
      expect(nextCalled).toBe(false)
      expect(res.statusCode).toBe(401)
    })

    it('rejects /api/anything.js without a token', () => {
      const { nextCalled, res } = run(makeReq('/api/anything.js'))
      expect(nextCalled).toBe(false)
      expect(res.statusCode).toBe(401)
    })
  })

  describe('bearer token extraction', () => {
    it('accepts case-sensitive "Bearer <token>"', () => {
      const { nextCalled } = run(
        makeReq('/api/protected', { headers: { authorization: 'Bearer Aa1!Aa1!' } }),
      )
      expect(nextCalled).toBe(true)
    })

    it('accepts case-insensitive "bearer <token>"', () => {
      const { nextCalled } = run(
        makeReq('/api/protected', { headers: { authorization: 'bearer Aa1!Aa1!' } }),
      )
      expect(nextCalled).toBe(true)
    })

    it('rejects when the scheme is not Bearer (does NOT fall back to entire header as the token)', () => {
      // Regression: previous code returned the full header string as the
      // token when the scheme did not match, which would compare against
      // the stored credential and pollute lockout counters.
      const { nextCalled, res } = run(
        makeReq('/api/protected', { headers: { authorization: 'Basic Aa1!Aa1!' } }),
      )
      expect(nextCalled).toBe(false)
      expect(res.statusCode).toBe(401)
      expect((res.body as { error: string }).error).toBe('No authorization token')
    })

    it('rejects a malformed Bearer header without value', () => {
      const { nextCalled, res } = run(
        makeReq('/api/protected', { headers: { authorization: 'Bearer' } }),
      )
      expect(nextCalled).toBe(false)
      expect(res.statusCode).toBe(401)
    })

    it('rejects a Bearer header with a wrong token', () => {
      const { nextCalled, res } = run(
        makeReq('/api/protected', { headers: { authorization: 'Bearer wrong' } }),
      )
      expect(nextCalled).toBe(false)
      expect(res.statusCode).toBe(401)
      expect((res.body as { error: string }).error).toBe('Invalid token')
    })

    it('accepts a valid query token (download path)', () => {
      const { nextCalled } = run(
        makeReq('/api/protected', { query: { token: 'Aa1!Aa1!' } }),
      )
      expect(nextCalled).toBe(true)
    })
  })
})
