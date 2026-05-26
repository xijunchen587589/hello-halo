/**
 * Password policy unit tests — complexity rules enforced at the
 * setCustomAccessToken boundary.
 */

import { describe, it, expect } from 'vitest'

import { validatePassword } from '../../../../src/main/http/auth/password-policy'

describe('password-policy', () => {
  describe('length', () => {
    it('rejects passwords shorter than 8 characters', () => {
      const result = validatePassword('Ab1!')
      expect(result.ok).toBe(false)
      expect(result.error).toContain('at least 8')
    })

    it('accepts exactly 8 characters when all four classes present', () => {
      expect(validatePassword('Aa1!Aa1!').ok).toBe(true)
    })

    it('rejects passwords longer than 64 characters', () => {
      const longPassword = 'Aa1!' + 'x'.repeat(62)
      expect(validatePassword(longPassword).ok).toBe(false)
    })
  })

  describe('character classes', () => {
    it('rejects when uppercase letter is missing', () => {
      const result = validatePassword('abcdef1!')
      expect(result.ok).toBe(false)
      expect(result.error).toContain('uppercase')
    })

    it('rejects when lowercase letter is missing', () => {
      const result = validatePassword('ABCDEF1!')
      expect(result.ok).toBe(false)
      expect(result.error).toContain('lowercase')
    })

    it('rejects when digit is missing', () => {
      const result = validatePassword('Abcdefg!')
      expect(result.ok).toBe(false)
      expect(result.error).toContain('digit')
    })

    it('rejects when special character is missing', () => {
      const result = validatePassword('Abcdef12')
      expect(result.ok).toBe(false)
      expect(result.error).toContain('special')
    })

    it('lists all missing classes in the error', () => {
      const result = validatePassword('aaaaaaaa')
      expect(result.ok).toBe(false)
      expect(result.error).toContain('uppercase')
      expect(result.error).toContain('digit')
      expect(result.error).toContain('special')
    })

    it('accepts a wide range of ASCII specials', () => {
      // Cover the four ranges in the regex (!-/, :-@, [-`, {-~)
      expect(validatePassword('Abcdef1#').ok).toBe(true) // #
      expect(validatePassword('Abcdef1@').ok).toBe(true) // @
      expect(validatePassword('Abcdef1[').ok).toBe(true) // [
      expect(validatePassword('Abcdef1{').ok).toBe(true) // {
    })
  })

  describe('type guards', () => {
    it('rejects non-string inputs without throwing', () => {
      expect(validatePassword(undefined as unknown as string).ok).toBe(false)
      expect(validatePassword(null as unknown as string).ok).toBe(false)
      expect(validatePassword(12345678 as unknown as string).ok).toBe(false)
    })
  })
})
