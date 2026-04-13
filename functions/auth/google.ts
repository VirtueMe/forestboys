/**
 * GET /auth/google — redirect to Google OAuth consent screen
 */

interface Env {
  GOOGLE_CLIENT_ID: string
}

export const onRequestGet: PagesFunction<Env> = ({ request, env }) => {
  const url = new URL(request.url)
  const redirectUri = `${url.origin}/auth/callback`

  const params = new URLSearchParams({
    client_id:     env.GOOGLE_CLIENT_ID,
    redirect_uri:  redirectUri,
    response_type: 'code',
    scope:         'openid email profile',
    access_type:   'online',
  })

  return Response.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`, 302)
}
