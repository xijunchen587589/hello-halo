/**
 * Token store unit tests. Covers PIN generation, custom-password policy
 * enforcement, restore flow, and the timing-safe compare semantics.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../../../../src/main/services/security-policy', () => ({
  isCredentialAtRestSafe: vi.fn(() => false),
}))

import {
  generateAccessToken,
  restoreAccessToken,
  setCustomAccessToken,
  getAccessToken,
  clearAccessToken,
  validateToken,
  CredentialRestoreError,
} from '../../../../src/main/http/auth/token-store'
import { validatePassword } from '../../../../src/main/http/auth/password-policy'

describe('token-store', () => {
  beforeEach(() => {
    clearAccessToken()
  })

  describe('generateAccessToken', () => {
    it('returns a 12-character token', () => {
      const token = generateAccessToken()
      expect(token).toHaveLength(12)
    })

    it('satisfies the complexity policy on every generation (50 samples)', () => {
      for (let i = 0; i < 50; i++) {
        const token = generateAccessToken()
        const result = validatePassword(token)
        expect(result.ok, `failed on sample "${token}": ${result.error}`).toBe(true)
      }
    })

    it('exposes the generated token via getAccessToken', () => {
      const token = generateAccessToken()
      expect(getAccessToken()).toBe(token)
    })

    it('produces distinct values across calls (entropy sanity, 50 samples)', () => {
      const seen = new Set<string>()
      for (let i = 0; i < 50; i++) seen.add(generateAccessToken())
      // 12 chars × ~70 char alphabet → vastly more space than 6-digit PIN;
      // collisions across 50 samples are astronomically unlikely.
      expect(seen.size).toBe(50)
    })

    it('uses only the documented charset (no confusables, no out-of-range specials)', () => {
      const allowed = /^[A-HJ-NP-Z2-9a-km-np-z!@#$%^&*\-_=+]+$/
      for (let i = 0; i < 20; i++) {
        const token = generateAccessToken()
        expect(token, `unexpected char in "${token}"`).toMatch(allowed)
      }
    })
  })

  describe('setCustomAccessToken', () => {
    it('accepts a complexity-compliant password and exposes it', () => {
      const result = setCustomAccessToken('Aa1!Aa1!')
      expect(result.ok).toBe(true)
      expect(getAccessToken()).toBe('Aa1!Aa1!')
    })

    it('rejects a weak password and leaves the store unchanged', () => {
      generateAccessToken()
      const before = getAccessToken()
      const result = setCustomAccessToken('short')
      expect(result.ok).toBe(false)
      expect(result.error).toBeDefined()
      expect(getAccessToken()).toBe(before)
    })
  })

  describe('restoreAccessToken', () => {
    it('restores a plain stored value into memory and reports ok', () => {
      const result = restoreAccessToken('123456')
      expect(result.ok).toBe(true)
      expect(getAccessToken()).toBe('123456')
    })

    it('reports failure and clears in-memory state when decode fails', () => {
      // Bogus marker payload — decodeFromStorage returns ''
      const result = restoreAccessToken('gmcred:v1:not-base64!@#')
      expect(result.ok).toBe(false)
      expect(getAccessToken()).toBeNull()
    })

    it('reports failure on empty input', () => {
      const result = restoreAccessToken('')
      expect(result.ok).toBe(false)
      expect(getAccessToken()).toBeNull()
    })
  })

  describe('CredentialRestoreError', () => {
    it('carries a stable code so callers can branch without parsing text', () => {
      const err = new CredentialRestoreError()
      expect(err.code).toBe('CREDENTIAL_RESTORE_FAILED')
      expect(err).toBeInstanceOf(Error)
    })
  })

  describe('validateToken', () => {
    it('returns false when no token is set', () => {
      expect(validateToken('whatever')).toBe(false)
    })

    it('returns true for the exact stored value', () => {
      setCustomAccessToken('Aa1!Aa1!')
      expect(validateToken('Aa1!Aa1!')).toBe(true)
    })

    it('returns false for a different value of the same length', () => {
      setCustomAccessToken('Aa1!Aa1!')
      expect(validateToken('Bb2@Bb2@')).toBe(false)
    })

    it('returns false for a value of a different length', () => {
      setCustomAccessToken('Aa1!Aa1!')
      expect(validateToken('Aa1!Aa1!X')).toBe(false)
      expect(validateToken('Aa1!Aa1')).toBe(false)
    })

    it('returns false for non-string inputs', () => {
      setCustomAccessToken('Aa1!Aa1!')
      expect(validateToken(undefined as unknown as string)).toBe(false)
      expect(validateToken(null as unknown as string)).toBe(false)
      expect(validateToken(12345678 as unknown as string)).toBe(false)
    })
  })

  describe('clearAccessToken', () => {
    it('removes the in-memory token', () => {
      generateAccessToken()
      expect(getAccessToken()).not.toBeNull()
      clearAccessToken()
      expect(getAccessToken()).toBeNull()
    })
  })
})
