import { describe, expect, it } from 'vitest'
import { parseFailureDetail } from './failureDetail'

describe('parseFailureDetail', () => {
  it.each([
    'token:incorrect_client_credentials',
    'user:http_401',
    'exception:TypeError',
    'exception:Error',
  ])('keeps %s', (d) => {
    expect(parseFailureDetail(d)).toBe(d)
  })

  it.each([
    '',
    'has space',
    '<script>alert(1)</script>',
    'a/b',
    'x'.repeat(61),
  ])('drops "%s"', (d) => {
    expect(parseFailureDetail(d)).toBeNull()
  })

  it('drops non-strings (repeated or missing query parameters)', () => {
    expect(parseFailureDetail(undefined)).toBeNull()
    expect(parseFailureDetail(['a', 'b'])).toBeNull()
    expect(parseFailureDetail(null)).toBeNull()
  })
})
