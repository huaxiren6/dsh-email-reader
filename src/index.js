/**
 * dsh-email — IMAP email reader for DeepSeek Harness.
 *
 * What it mounts (three model-callable tools):
 *   email_list    — list recent messages in a mailbox (envelope + flags)
 *   email_read    — fetch one message's full text body (by UID or seq)
 *   email_search  — IMAP SEARCH over sender/subject/body, newest first
 *
 * Accounts come from plugin config. Two forms are accepted:
 *   - flat (single account):  host, port, user, pass|refreshToken, mailbox
 *   - multi-account:          accounts: [ { id, host, port, user, pass|refreshToken, ... } ]
 *
 * Authentication is decided per account:
 *   - pass         -> IMAP PLAIN/LOGIN (Gmail app password works via pass)
 *   - refreshToken -> OAuth2: fetch a fresh access token from tokenUrl
 *                     (Microsoft IMAP scope by default), then AUTH=XOAUTH2.
 *   - accessToken  -> static token used directly (no refresh).
 *
 * Env fallbacks for the flat/default account keep secrets out of the yaml:
 *   DSH_IMAP_HOST/PORT/USER/PASS/MAILBOX/TLS, plus OAUTH-ish
 *   DSH_IMAP_CLIENT_ID / DSH_IMAP_TOKEN_URL for OAuth.
 *
 * Every tool takes `account` (id from accounts[], default = first usable
 * account) and an optional `connection` override so one plugin can reach
 * several servers ad hoc.
 *
 * Safety: every tool returns { ok, ... } / { ok:false, error } and NEVER
 * throws, so a misconfigured/offline account (or a bad OAuth token) cannot
 * crash the host. Secrets are never logged.
 */

import { ImapFlow } from 'imapflow'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'dsh-email-reader'
export const inject = ['tools']

const __dirname = dirname(fileURLToPath(import.meta.url))

const DEFAULT_OAUTH_SCOPE = 'https://outlook.office.com/IMAP.AccessAsUser.All offline_access'
const DEFAULT_TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token'

function env(name) {
  return process.env[name] ?? ''
}

/** Normalize flat config OR `accounts[]` into a uniform account list. */
function buildAccounts(config) {
  const c = (config ?? {})
  const list = Array.isArray(c.accounts) && c.accounts.length ? c.accounts : [c]
  return list.map((a, i) => {
    const tlsRaw = String(a.tls ?? env('DSH_IMAP_TLS') ?? 'true').toLowerCase()
    const id = a.id ?? a.name ?? a.label
    return {
      id: String(id ?? (a.user ? String(a.user).split('@')[0] : `account-${i + 1}`)),
      host: a.host || env('DSH_IMAP_HOST') || '',
      port: Number(a.port ?? env('DSH_IMAP_PORT') ?? 993),
      user: a.user || env('DSH_IMAP_USER') || '',
      pass: a.pass || a.password || env('DSH_IMAP_PASS') || '',
      // OAuth fields
      accessToken: a.accessToken || '',
      refreshToken: a.refreshToken || env('DSH_IMAP_OAUTH_REFRESH') || '',
      clientId: a.clientId || env('DSH_IMAP_CLIENT_ID') || '',
      clientSecret: a.clientSecret || '',
      scope: a.scope || DEFAULT_OAUTH_SCOPE,
      tokenUrl: a.tokenUrl || env('DSH_IMAP_TOKEN_URL') || DEFAULT_TOKEN_URL,
      mailbox: a.mailbox || env('DSH_IMAP_MAILBOX') || 'INBOX',
      // Optional HTTP/SOCKS proxy for this account (e.g. http://127.0.0.1:7892).
      // Needed when the IMAP host is only reachable through a local proxy
      // (education/corporate networks often block direct Google access).
      proxy: a.proxy || env('DSH_IMAP_PROXY') || '',
      secure: !['0', 'false', 'no', 'off'].includes(tlsRaw),
    }
  })
}

/** Which account a call should use: explicit id > first fully usable > first. */
function pickAccount(accounts, accountId, overrides = {}) {
  let acc = null
  if (accountId) acc = accounts.find((x) => x.id === String(accountId)) ?? null
  if (!acc) acc = accounts.find((x) => missingAccount(x).length === 0) ?? accounts[0] ?? null
  if (!acc) return null
  return { ...acc, ...overrides }
}

/** Required fields that make an account usable. OAuth counts as configured. */
function missingAccount(acc) {
  const missing = []
  if (!acc.host) missing.push('host')
  if (!acc.user) missing.push('user')
  const hasAuth = !!acc.pass || !!acc.accessToken || (!!acc.refreshToken && !!acc.clientId)
  if (!hasAuth) missing.push('pass 或 (refreshToken+clientId)')
  return missing
}

/** Exchange a refresh token for a fresh access token (provider-agnostic). */
async function fetchOAuthToken(acc) {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: acc.clientId,
    refresh_token: acc.refreshToken,
  })
  if (acc.clientSecret) body.set('client_secret', acc.clientSecret)
  if (acc.scope) body.set('scope', acc.scope)
  let res, data
  try {
    res = await fetch(acc.tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })
    data = await res.json().catch(() => null)
  } catch (e) {
    throw new Error(`无法访问 OAuth 令牌端点 ${acc.tokenUrl}: ${e.message}`)
  }
  if (!res.ok || !data?.access_token) {
    const detail = data?.error_description ?? data?.error ?? data?.error_message ?? res.statusText?.slice(0, 120)
    throw new Error(`OAuth 令牌交换失败 (HTTP ${res.status}): ${detail ?? '未知错误'}`)
  }
  return data.access_token
}

/**
 * Run one operation against a single account. NEVER throws — resolves to
 * { ok, ... } on success or { ok:false, error } on any failure.
 */
async function imapRun(acc, mailbox, fn) {
  const missing = missingAccount(acc)
  if (missing.length) return { ok: false, error: `邮箱账号「${acc.id}」配置不完整，缺少: ${missing.join('、')}` }

  let auth
  if (acc.refreshToken) {
    let token
    try { token = await fetchOAuthToken(acc) } catch (e) { return { ok: false, error: e.message } }
    auth = { user: acc.user, accessToken: token }
  } else if (acc.accessToken) {
    auth = { user: acc.user, accessToken: acc.accessToken }
  } else {
    auth = { user: acc.user, pass: acc.pass }
  }

  const client = new ImapFlow({
    host: acc.host,
    port: acc.port,
    secure: acc.secure,
    auth,
    ...(acc.proxy ? { proxy: acc.proxy } : {}),
    logger: false,
    connectionTimeout: 15000,
    socketTimeout: 15000,
  })
  try {
    await client.connect()
  } catch (e) {
    return { ok: false, error: `连接账号 ${acc.id} (${acc.user} @ ${acc.host}) 失败: ${e.message}` }
  }
  try {
    const lock = await client.getMailboxLock(mailbox)
    try {
      const value = await fn(client)
      return { ok: true, account: acc.id, mailbox, ...value }
    } finally {
      lock.release()
    }
  } catch (e) {
    return { ok: false, error: `邮箱操作失败 (${acc.id}@${mailbox}): ${e.message}` }
  } finally {
    await client.logout().catch(() => {})
  }
}

/** Pull text content out of a parsed message body structure. */
function bodyText(msg) {
  const parts = msg.bodyParts ?? msg.body ?? {}
  const candidates = [
    parts['text/plain'],
    parts['TEXT/PLAIN'],
    parts['text/html'],
    parts['TEXT/HTML'],
  ].filter(Boolean)
  if (candidates.length) {
    const first = candidates[0]
    const buf = first?.content ?? first?.value ?? ''
    const charset = first?.charset ?? 'utf-8'
    try {
      return Buffer.isBuffer(buf) ? buf.toString(charset) : String(buf)
    } catch {
      return String(buf)
    }
  }
  return ''
}

/**
 * Extract readable text from a raw RFC-5322 message source without external
 * parser deps. Handles multipart boundaries, base64 / quoted-printable
 * transfer encodings, and strips HTML tags. Falls back to a plain read when
 * nothing structured is found. (Outlook's IMAP rejects non-standard
 * bodyParts fetches, so email_read fetches `source` and parses here.)
 */
function extractTextFromSource(raw) {
  try {
    const src = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw)
    const boundaryMatch = src.match(/boundary="?([^";\s]+)"?/i)
    let part = src
    if (boundaryMatch) {
      const chunks = src.split(`--${boundaryMatch[1]}`)
      const plain = chunks.find((c) => /content-type:\s*text\/plain/i.test(c))
      const html = chunks.find((c) => /content-type:\s*text\/html/i.test(c))
      part = plain ?? html ?? (chunks.length > 1 ? chunks[chunks.length - 2] : src)
    }
    const ctIdx = part.indexOf('\r\n\r\n')
    const headers = ctIdx >= 0 ? part.slice(0, ctIdx) : ''
    let content = ctIdx >= 0 ? part.slice(ctIdx + 4) : part
    const encMatch = headers.match(/content-transfer-encoding:\s*(\S+)/i)
    const enc = encMatch ? encMatch[1].toLowerCase() : ''
    if (enc === 'base64') {
      const cleaned = content.replace(/\s+/g, '')
      content = Buffer.from(cleaned, 'base64').toString('utf8')
    } else if (enc === 'quoted-printable') {
      content = content
        .replace(/=\r?\n/g, '')
        .replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    }
    if (/content-type:\s*text\/html/i.test(headers)) {
      content = content.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/\s+/g, ' ').trim()
    }
    return content.trim()
  } catch {
    return ''
  }
}

function summarizeEnvelope(msg, seq) {
  const env = msg.envelope ?? {}
  const from = (env.from ?? []).map((a) => a.address ?? a.name).filter(Boolean).join(', ')
  const subject = env.subject ?? ''
  return {
    seq: seq ?? msg.seq,
    uid: msg.uid ?? null,
    // imapflow returns a Date object here; DSH requires lossless-JSON output,
    // so normalize to an ISO string (null when absent).
    date: env.date instanceof Date ? env.date.toISOString() : (env.date ?? null),
    from,
    subject,
    flags: Array.isArray(msg.flags) ? msg.flags.map(String) : Array.from(msg.flags ?? []).map(String),
  }
}

export function apply(ctx, config) {
  const accounts = buildAccounts(config ?? {})
  const accountNames = accounts.map((a) => a.id)

  const connectionSchema = {
    type: 'object',
    additionalProperties: false,
    description: 'Optional per-call connection override (host/port/user/pass/tls).',
    properties: {
      host: { type: 'string' }, port: { type: 'number' }, user: { type: 'string' },
      pass: { type: 'string' }, tls: { type: 'boolean' }, mailbox: { type: 'string' },
    },
  }

  ctx.tools.register(defineTool({
    name: 'ol_email_list',
    description: `List recent messages in an IMAP mailbox (envelope + flags). Configured accounts: ${accountNames.join(', ') || 'none'}.`,
    parameters: {
      limit: { type: 'number', description: 'Max messages to list (default 20, max 100).' },
      account: { type: 'string', description: `Account id: ${accountNames.join(', ') || 'default'}.` },
      mailbox: { type: 'string', description: 'Mailbox/folder name (default account.mailbox or INBOX).' },
      connection: connectionSchema,
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          account: { type: 'string' },
          mailbox: { type: 'string' },
          total: { type: 'integer' },
          error: { type: 'string' },
          messages: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                seq: { type: 'integer' },
                uid: { type: 'integer' },
                date: { type: 'string' },
                from: { type: 'string' },
                subject: { type: 'string' },
                flags: { type: 'array', items: { type: 'string' } },
              },
            },
          },
        },
      },
      render(args, value) {
        if (!value.ok) return [{ type: 'text', text: `ol_email_list failed: ${value.error ?? 'unknown error'}` }]
        const lines = [`ol_email_list${value.account ? ` [${value.account}]` : ''}${value.mailbox ? ` (${value.mailbox})` : ''}: ${value.total} message(s)`]
        for (const m of value.messages ?? []) {
          lines.push(`  #${m.seq}${m.uid != null ? ` (uid=${m.uid})` : ''} ${m.date ?? ''} — ${m.from} — ${m.subject}`)
        }
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute({ limit, account, mailbox, connection }) {
      const acc = pickAccount(accounts, account, connection ?? {})
      if (!acc) return { ok: false, error: '未配置任何邮箱账号' }
      const mbox = mailbox ?? connection?.mailbox ?? acc.mailbox ?? 'INBOX'
      const n = Math.min(Number(limit ?? 20) || 20, 100)
      return imapRun(acc, mbox, async (client) => {
        // imapRun already holds the mailbox lock — do NOT lock again here
        // (imapflow locks are exclusive; double-locking deadlocks the call).
        const total = client.mailbox.exists
        const from = Math.max(1, total - n + 1)
        const list = []
        for await (const msg of client.fetch(`${from}:*`, { envelope: true, uid: true, flags: true })) {
          list.push(summarizeEnvelope(msg, msg.seq))
        }
        return { total, messages: list }
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'ol_email_read',
    description: `Read a single email message in full (subject, from, date, text body) by sequence number or UID. Configured accounts: ${accountNames.join(', ') || 'none'}. Use ol_email_list first to find the seq/uid.`,
    parameters: {
      seq: { type: 'number', description: 'Message sequence number (from ol_email_list).' },
      uid: { type: 'number', description: 'Alternative: message UID.' },
      account: { type: 'string', description: `Account id: ${accountNames.join(', ') || 'default'}.` },
      mailbox: { type: 'string', description: 'Mailbox/folder name (default account.mailbox or INBOX).' },
      connection: connectionSchema,
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          account: { type: 'string' },
          mailbox: { type: 'string' },
          error: { type: 'string' },
          message: {
            type: 'object',
            additionalProperties: false,
            properties: {
              seq: { type: 'integer' },
              uid: { type: 'integer' },
              date: { type: 'string' },
              from: { type: 'string' },
              to: { type: 'string' },
              subject: { type: 'string' },
              flags: { type: 'array', items: { type: 'string' } },
              body: { type: 'string' },
            },
          },
        },
      },
      render(args, value) {
        if (!value.ok) return [{ type: 'text', text: `ol_email_read failed: ${value.error ?? 'unknown error'}` }]
        const m = value.message ?? {}
        const lines = [
          `subject: ${m.subject ?? ''}`,
          `from: ${m.from ?? ''}${m.to ? `\nto: ${m.to}` : ''}`,
          `date: ${m.date ?? ''}`,
          '',
          m.body ?? '',
        ]
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute({ seq, uid, account, mailbox, connection }) {
      if (!seq && !uid) return { ok: false, error: 'Provide seq or uid.' }
      const acc = pickAccount(accounts, account, connection ?? {})
      if (!acc) return { ok: false, error: '未配置任何邮箱账号' }
      const mbox = mailbox ?? connection?.mailbox ?? acc.mailbox ?? 'INBOX'
      const range = uid ? { uid: String(uid) } : String(seq)
      return imapRun(acc, mbox, async (client) => {
        // Outlook IMAP rejects imapflow's non-standard bodyParts fetch, so we
        // fetch the raw source and parse MIME locally.
        const msg = await client.fetchOne(range, {
          envelope: true,
          uid: true,
          flags: true,
          source: true,
        })
        if (!msg) return { ok: false, error: `Message not found (${range}) in ${mbox}.` }
        const env = msg.envelope ?? {}
        return {
          message: {
            seq: seq ?? msg.seq,
            uid: msg.uid ?? null,
            date: env.date instanceof Date ? env.date.toISOString() : (env.date ?? null),
            from: (env.from ?? []).map((a) => a.address ?? a.name).filter(Boolean).join(', '),
            to: (env.to ?? []).map((a) => a.address ?? a.name).filter(Boolean).join(', '),
            subject: env.subject ?? '',
            flags: Array.isArray(msg.flags) ? msg.flags.map(String) : Array.from(msg.flags ?? []).map(String),
            body: (extractTextFromSource(msg.source) || bodyText(msg)).slice(0, 200_000),
          },
        }
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'ol_email_search',
    description: `Search messages in an IMAP mailbox by sender, subject, or body keyword. Returns newest first. Configured accounts: ${accountNames.join(', ') || 'none'}.`,
    parameters: {
      query: { type: 'string', required: true, description: 'Search term(s).' },
      limit: { type: 'number', description: 'Max results (default 20, max 100).' },
      account: { type: 'string', description: `Account id: ${accountNames.join(', ') || 'default'}.` },
      mailbox: { type: 'string', description: 'Mailbox/folder name (default account.mailbox or INBOX).' },
      connection: connectionSchema,
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          account: { type: 'string' },
          mailbox: { type: 'string' },
          query: { type: 'string' },
          total: { type: 'integer' },
          error: { type: 'string' },
          messages: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                seq: { type: 'integer' },
                uid: { type: 'integer' },
                date: { type: 'string' },
                from: { type: 'string' },
                subject: { type: 'string' },
                flags: { type: 'array', items: { type: 'string' } },
              },
            },
          },
        },
      },
      render(args, value) {
        if (!value.ok) return [{ type: 'text', text: `ol_email_search failed: ${value.error ?? 'unknown error'}` }]
        const lines = [`ol_email_search "${value.query}"${value.account ? ` [${value.account}]` : ''}${value.mailbox ? ` (${value.mailbox})` : ''}: ${value.total} hit(s)`]
        for (const m of value.messages ?? []) {
          lines.push(`  #${m.seq}${m.uid != null ? ` (uid=${m.uid})` : ''} ${m.date ?? ''} — ${m.from} — ${m.subject}`)
        }
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute({ query, limit, account, mailbox, connection }) {
      const acc = pickAccount(accounts, account, connection ?? {})
      if (!acc) return { ok: false, error: '未配置任何邮箱账号' }
      const mbox = mailbox ?? connection?.mailbox ?? acc.mailbox ?? 'INBOX'
      const n = Math.min(Number(limit ?? 20) || 20, 100)
      const term = String(query ?? '').trim()
      if (!term) return { ok: false, error: 'Provide a query.' }
      return imapRun(acc, mbox, async (client) => {
        // IMAP SEARCH is server-side; TEXT covers subject/body/headers.
        const seqs = await client.search({ text: term }, { uid: false })
        const total = seqs.length
        const want = seqs.slice(-n)
        const list = []
        if (want.length) {
          const range = want.length === 1 ? String(want[0]) : `${want[0]}:${want[want.length - 1]}`
          for await (const msg of client.fetch(range, { envelope: true, uid: true, flags: true })) {
            list.push(summarizeEnvelope(msg, msg.seq))
          }
        }
        return { total, messages: list.reverse() }
      })
    },
  }))
}