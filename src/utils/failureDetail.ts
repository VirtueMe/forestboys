/**
 * The short code a failed OAuth sign-in carries back to /access
 * (`detail` in functions/_lib/oauth.ts accessError), e.g.
 * `token:incorrect_client_credentials` or `exception:TypeError`.
 *
 * It lands in the URL, so only plain codes are shown: letters, digits,
 * underscore and colon. Anything else is dropped, not rendered.
 */
export function parseFailureDetail(raw: unknown): string | null {
  return typeof raw === 'string' && /^[A-Za-z0-9_:]{1,60}$/.test(raw) ? raw : null
}
