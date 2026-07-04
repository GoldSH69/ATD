import { shell } from 'electron'
import { randomBytes } from 'crypto'
import { createServer, type ServerResponse } from 'http'
import type { ThreadsOAuthResult, ThreadsSettings } from './types'
import { testThreads } from './threadsApi'

const AUTHORIZE_URL = 'https://threads.net/oauth/authorize'
const SHORT_TOKEN_URL = 'https://graph.threads.net/oauth/access_token'
const LONG_TOKEN_URL = 'https://graph.threads.net/access_token'
const OAUTH_TIMEOUT_MS = 180_000

type OAuthCfg = Pick<ThreadsSettings, 'appId' | 'appSecret' | 'redirectUri' | 'scopes'>

interface CallbackPayload {
  code: string
}

interface TokenReply {
  access_token?: string
  user_id?: string | number
  expires_in?: number
  error?: { message?: string }
}

const snippet = (text: string): string => text.replace(/\s+/g, ' ').trim().slice(0, 200)
const normalizeScopes = (raw: string): string =>
  raw
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .join(',')

function writeCallbackPage(res: ServerResponse, title: string, body: string): void {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  res.end(`<!doctype html>
<html>
<head><meta charset="utf-8"><title>${title}</title></head>
<body style="font: 15px -apple-system, BlinkMacSystemFont, sans-serif; margin: 2rem;">
  <h1>${title}</h1>
  <p>${body}</p>
</body>
</html>`)
}

async function readJson(label: string, res: Response): Promise<TokenReply> {
  const body = await res.text()
  let data: TokenReply
  try {
    data = JSON.parse(body) as TokenReply
  } catch {
    throw new Error(`${label}: unexpected non-JSON response (HTTP ${res.status}) - ${snippet(body)}`)
  }
  if (!res.ok) {
    throw new Error(`${label}: ${data.error?.message || `HTTP ${res.status} - ${snippet(body)}`}`)
  }
  return data
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 30_000)
  try {
    return await fetch(url, { ...init, signal: ctrl.signal })
  } catch (err) {
    if (ctrl.signal.aborted) throw new Error(`Request timed out after 30s (${url})`)
    throw err
  } finally {
    clearTimeout(timer)
  }
}

function waitForCallback(redirectUri: URL, state: string): Promise<CallbackPayload> {
  if (redirectUri.protocol !== 'http:') {
    throw new Error('Threads OAuth redirect URI must be a local http URL')
  }
  if (redirectUri.hostname !== '127.0.0.1' && redirectUri.hostname !== 'localhost') {
    throw new Error('Threads OAuth redirect URI must use localhost or 127.0.0.1')
  }
  const port = Number(redirectUri.port)
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error('Threads OAuth redirect URI must include an explicit local port')
  }

  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      let shouldClose = false
      try {
        const reqUrl = new URL(req.url || '/', redirectUri.origin)
        if (reqUrl.pathname !== redirectUri.pathname) {
          res.writeHead(404).end()
          return
        }
        shouldClose = true

        const returnedState = reqUrl.searchParams.get('state') || ''
        const error = reqUrl.searchParams.get('error_description') || reqUrl.searchParams.get('error') || ''
        const code = reqUrl.searchParams.get('code') || ''

        if (returnedState !== state) {
          writeCallbackPage(res, 'AutoThreads OAuth failed', 'The callback state did not match. You can close this tab.')
          reject(new Error('Threads OAuth callback state mismatch'))
          return
        }
        if (error) {
          writeCallbackPage(res, 'AutoThreads OAuth canceled', 'Threads returned an authorization error. You can close this tab.')
          reject(new Error(`Threads OAuth: ${error}`))
          return
        }
        if (!code) {
          writeCallbackPage(res, 'AutoThreads OAuth failed', 'No authorization code was returned. You can close this tab.')
          reject(new Error('Threads OAuth callback did not include an authorization code'))
          return
        }

        writeCallbackPage(res, 'AutoThreads connected', 'Authorization finished. You can return to AutoThreads.')
        resolve({ code })
      } finally {
        if (shouldClose) server.close()
      }
    })

    const timer = setTimeout(() => {
      server.close()
      reject(new Error('Threads OAuth timed out waiting for browser authorization'))
    }, OAUTH_TIMEOUT_MS)

    server.once('close', () => clearTimeout(timer))
    server.once('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    server.listen(port, redirectUri.hostname)
  })
}

async function exchangeCode(cfg: OAuthCfg, code: string): Promise<{ accessToken: string; userId: string; tokenExpiresAt: number | null }> {
  const shortRes = await fetchWithTimeout(SHORT_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: cfg.appId.trim(),
      client_secret: cfg.appSecret,
      grant_type: 'authorization_code',
      redirect_uri: cfg.redirectUri.trim(),
      code,
    }),
  })
  const shortToken = await readJson('Threads OAuth short token', shortRes)
  if (!shortToken.access_token) throw new Error('Threads OAuth short-token response did not include access_token')

  const longUrl = new URL(LONG_TOKEN_URL)
  longUrl.searchParams.set('grant_type', 'th_exchange_token')
  longUrl.searchParams.set('client_secret', cfg.appSecret)
  longUrl.searchParams.set('access_token', shortToken.access_token)
  const longRes = await fetchWithTimeout(longUrl.toString(), { method: 'GET' })
  const longToken = await readJson('Threads OAuth long token', longRes)
  if (!longToken.access_token) throw new Error('Threads OAuth long-token response did not include access_token')

  const expiresIn = typeof longToken.expires_in === 'number' && Number.isFinite(longToken.expires_in) ? longToken.expires_in : 0
  return {
    accessToken: longToken.access_token,
    userId: shortToken.user_id === undefined ? '' : String(shortToken.user_id),
    tokenExpiresAt: expiresIn > 0 ? Date.now() + expiresIn * 1000 : null,
  }
}

export async function startThreadsOAuth(cfg: OAuthCfg): Promise<ThreadsOAuthResult> {
  try {
    if (!cfg.appId.trim()) return { ok: false, message: 'Threads app ID is required' }
    if (!cfg.appSecret.trim()) return { ok: false, message: 'Threads app secret is required' }
    const redirectUri = new URL(cfg.redirectUri.trim())
    const scopes = normalizeScopes(cfg.scopes)
    if (!scopes) return { ok: false, message: 'At least one Threads scope is required' }

    const state = randomBytes(24).toString('hex')
    const callbackPromise = waitForCallback(redirectUri, state)
    const authUrl = new URL(AUTHORIZE_URL)
    authUrl.searchParams.set('client_id', cfg.appId.trim())
    authUrl.searchParams.set('redirect_uri', redirectUri.toString())
    authUrl.searchParams.set('scope', scopes)
    authUrl.searchParams.set('response_type', 'code')
    authUrl.searchParams.set('state', state)

    await shell.openExternal(authUrl.toString())
    const callback = await callbackPromise
    const token = await exchangeCode({ ...cfg, scopes }, callback.code)
    const test = await testThreads({ accessToken: token.accessToken, userId: token.userId })
    if (!test.ok) return { ok: false, message: test.message }

    return {
      ok: true,
      message: token.tokenExpiresAt
        ? `Connected as @${test.username}; token expires ${new Date(token.tokenExpiresAt).toLocaleDateString()}.`
        : `Connected as @${test.username}.`,
      accessToken: token.accessToken,
      userId: test.userId || token.userId,
      username: test.username || '',
      tokenExpiresAt: token.tokenExpiresAt,
    }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) }
  }
}
