/**
 * POST /auth/logout — clear session cookie
 */

import { clearSessionCookie } from '../_lib/session.ts'

export const onRequestPost: PagesFunction = () => {
  return new Response(null, {
    status: 302,
    headers: {
      Location:     '/',
      'Set-Cookie': clearSessionCookie(),
    },
  })
}
