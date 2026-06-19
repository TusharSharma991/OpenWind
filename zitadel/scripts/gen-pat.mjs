#!/usr/bin/env node
// gen-pat.mjs — runs inside the ow-zita-setup container.
//
// Flow:
//   1. Wait for Zitadel to be healthy
//   2. Create a session for the admin user via Sessions API v2 (password-based)
//   3. Get userId from the session details
//   4. Exchange the session token for an OAuth access token (Token Exchange grant)
//   5. Create a Personal Access Token for the admin user via Management API v1
//   6. Print the PAT + the exact command to run in the OpenWind folder

import { request as nodeRequest } from 'node:http'

const ZITADEL_HOST = 'zitadel'
const ZITADEL_PORT = 8080
// Zitadel routes requests by Host header — must match EXTERNALDOMAIN
const HOST_HEADER  = process.env.ZITADEL_EXTERNALDOMAIN ?? 'localhost'
const ADMIN_LOGIN  = 'owZitadelAdmin@openwind.local'
const ADMIN_PASS   = 'Admin1234!'
const PAT_EXPIRY   = '2030-01-01T00:00:00Z'

// ── HTTP helpers ──────────────────────────────────────────────────────────────

function httpReq(method, path, headers, body) {
  return new Promise((resolve, reject) => {
    const bodyBuf = body ? Buffer.from(body, 'utf8') : null
    const req = nodeRequest(
      {
        hostname: ZITADEL_HOST,
        port:     ZITADEL_PORT,
        path,
        method,
        headers: {
          Host: HOST_HEADER,
          ...headers,
          ...(bodyBuf ? { 'Content-Length': String(bodyBuf.length) } : {}),
        },
      },
      (res) => {
        let data = ''
        res.on('data', (chunk) => { data += chunk.toString() })
        res.on('end', () => resolve({ status: res.statusCode, text: data }))
      }
    )
    req.setTimeout(20_000, () => req.destroy(new Error('Request timed out')))
    req.on('error', reject)
    if (bodyBuf) req.write(bodyBuf)
    req.end()
  })
}

function jsonPost(path, token, body) {
  return httpReq('POST', path, {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }, JSON.stringify(body))
}

function jsonGet(path, token) {
  return httpReq('GET', path, {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }, null)
}

function formPost(path, params) {
  return httpReq('POST', path, {
    'Content-Type': 'application/x-www-form-urlencoded',
  }, new URLSearchParams(params).toString())
}

function assertOk(res, label) {
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`${label} — HTTP ${res.status}: ${res.text}`)
  }
  return JSON.parse(res.text)
}

// ── Health wait ───────────────────────────────────────────────────────────────

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function waitForHealth() {
  for (let i = 1; i <= 80; i++) {
    try {
      const res = await httpReq('GET', '/healthz', {}, null)
      if (res.status < 500) return
    } catch { /* not ready yet */ }
    if (i % 5 === 0) log(`  Still waiting for Zitadel… (${i * 3}s elapsed)`)
    await sleep(3000)
  }
  throw new Error('Zitadel did not become healthy after 4 minutes.')
}

// ── Logging ───────────────────────────────────────────────────────────────────

const G = '\x1b[32m', Y = '\x1b[33m', C = '\x1b[36m', B = '\x1b[1m', R = '\x1b[0m', D = '\x1b[2m'
function log(msg)  { console.log(msg) }
function ok(msg)   { console.log(`  ${G}✓${R}  ${msg}`) }
function info(msg) { console.log(`  ${D}→${R}  ${msg}`) }

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`
${B}${C}  OpenWind — Zitadel Setup${R}
  ${'─'.repeat(40)}
`)

  // 1. Wait for Zitadel
  log('  ⏳  Waiting for Zitadel to be healthy…')
  await waitForHealth()
  ok('Zitadel is up')
  info('Waiting 15s for first-boot internal setup to complete…')
  await sleep(15_000)
  console.log()

  // 2. Create session
  log('  ⏳  Creating admin session…')
  const sessionRes = await jsonPost('/v2/sessions', null, {
    checks: {
      user:     { loginName: ADMIN_LOGIN },
      password: { password: ADMIN_PASS },
    },
  })
  const { sessionId, sessionToken } = assertOk(sessionRes, 'Create session')
  ok(`Session created (id=${sessionId})`)
  console.log()

  // 3. Get userId from session details
  log('  ⏳  Fetching user info from session…')
  const detailRes = await jsonGet(`/v2/sessions/${sessionId}`, sessionToken)
  const { session } = assertOk(detailRes, 'Get session details')
  const userId = session?.factors?.user?.userId
  if (!userId) throw new Error(`Could not extract userId from session response:\n${detailRes.text}`)
  ok(`User ID: ${userId}`)
  console.log()

  // 4. Token exchange: session token → OAuth access token
  log('  ⏳  Exchanging session token for access token…')
  const tokenRes = await formPost('/oauth/v2/token', {
    grant_type:           'urn:ietf:params:oauth:grant-type:token-exchange',
    requested_token_type: 'urn:ietf:params:oauth:token-type:access_token',
    subject_token:        sessionToken,
    subject_token_type:   'urn:ietf:params:oauth:token-type:session',
    scope:                'openid urn:zitadel:iam:org:project:id:zitadel:aud',
  })
  const { access_token: accessToken } = assertOk(tokenRes, 'Token exchange')
  if (!accessToken) throw new Error(`access_token missing in token exchange response: ${tokenRes.text}`)
  ok('Access token obtained')
  console.log()

  // 5. Create PAT for admin user
  log('  ⏳  Creating Personal Access Token…')
  const patRes = await jsonPost(`/management/v1/users/${userId}/pats`, accessToken, {
    expirationDate: PAT_EXPIRY,
  })
  const patData = assertOk(patRes, 'Create PAT')
  const pat = patData.token
  if (!pat) throw new Error(`No token field in PAT response: ${patRes.text}`)
  ok('PAT created')
  console.log()

  // 6. Print result
  const line = '═'.repeat(58)
  console.log(`\n  ${B}${G}${line}${R}`)
  console.log(`  ${B}${G}✅  PAT generated — copy the command below${R}`)
  console.log(`  ${B}${G}${line}${R}\n`)
  console.log(`  ${B}Run this in the ${C}OpenWind${R}${B} folder:${R}\n`)
  console.log(`  ${Y}Windows :${R}  setup.bat --pat ${B}${pat}${R}`)
  console.log(`  ${Y}Linux/Mac:${R}  ./setup.sh --pat ${B}${pat}${R}`)
  console.log(`\n  ${B}${G}${line}${R}\n`)
}

main().catch((err) => {
  console.error(`\n  \x1b[31m✗\x1b[0m  ${err.message}\n`)
  process.exit(1)
})
