#!/usr/bin/env node
// gen-pat.mjs — runs inside the ow-zita-setup container.
//
// How it works:
//   Zitadel creates a machine user (ow-setup-bot) with a PAT at first boot via
//   ZITADEL_FIRSTINSTANCE_ORG_MACHINE_* env vars. The PAT token is logged by
//   Zitadel during initialisation. This script waits for Zitadel to be healthy,
//   reads the PAT from the container's logs via the Docker Engine API (unix socket),
//   then prints the exact command the user should run in the OpenWind folder.

import { request as nodeRequest } from 'node:http'
import { createConnection }       from 'node:net'

const ZITADEL_HOST     = 'zitadel'
const ZITADEL_PORT     = 8080
const ZITADEL_CTR_NAME = 'zitadel'
const DOCKER_SOCKET    = '/var/run/docker.sock'

// ── ANSI colours ─────────────────────────────────────────────────────────────
const G = '\x1b[32m', Y = '\x1b[33m', C = '\x1b[36m', B = '\x1b[1m', R = '\x1b[0m', D = '\x1b[2m'
function log(msg)  { console.log(msg) }
function ok(msg)   { console.log(`  ${G}✓${R}  ${msg}`) }
function info(msg) { console.log(`  ${D}→${R}  ${msg}`) }
function fail(msg) { console.error(`  \x1b[31m✗\x1b[0m  ${msg}`); process.exit(1) }

// ── HTTP over unix socket ─────────────────────────────────────────────────────

function dockerRequest(method, path) {
  return new Promise((resolve, reject) => {
    const socket = createConnection(DOCKER_SOCKET)
    let raw = ''
    socket.on('connect', () => {
      socket.write(`${method} ${path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n`)
    })
    socket.on('data', (chunk) => { raw += chunk.toString('binary') })
    socket.on('end', () => {
      const [head, ...bodyParts] = raw.split('\r\n\r\n')
      const statusLine = head.split('\r\n')[0]
      const status = parseInt(statusLine.split(' ')[1], 10)
      // Docker log endpoint uses chunked transfer — reassemble plain text
      const body = bodyParts.join('\r\n\r\n')
      resolve({ status, body })
    })
    socket.on('error', reject)
    socket.setTimeout(30_000, () => socket.destroy(new Error('Docker socket timeout')))
  })
}

// ── HTTP to Zitadel ───────────────────────────────────────────────────────────

function httpGet(path) {
  return new Promise((resolve, reject) => {
    const req = nodeRequest(
      { hostname: ZITADEL_HOST, port: ZITADEL_PORT, path, method: 'GET',
        headers: { Host: 'localhost' } },
      (res) => {
        let data = ''
        res.on('data', (c) => { data += c })
        res.on('end', () => resolve({ status: res.statusCode, text: data }))
      }
    )
    req.setTimeout(10_000, () => req.destroy(new Error('Zitadel HTTP timeout')))
    req.on('error', reject)
    req.end()
  })
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function waitForHealth() {
  for (let i = 1; i <= 80; i++) {
    try {
      const res = await httpGet('/healthz')
      if (res.status < 500) return
    } catch { /* not ready yet */ }
    if (i % 5 === 0) log(`  Still waiting for Zitadel… (${i * 3}s elapsed)`)
    await sleep(3000)
  }
  fail('Zitadel did not become healthy after 4 minutes.')
}

function extractPat(logText) {
  // Zitadel v4 logs the machine user PAT with a line like:
  //   "machine user pat created" pat="eyJ..."
  // or in structured JSON log format:
  //   {"level":"info","msg":"machine user pat created","pat":"eyJ..."}
  // We try both formats.
  const patterns = [
    /"pat"\s*:\s*"([A-Za-z0-9_\-\.]+)"/,       // JSON field
    /\bpat=["']?([A-Za-z0-9_\-\.]{20,})["']?/,  // key=value
  ]
  for (const re of patterns) {
    const m = logText.match(re)
    if (m && m[1]) return m[1]
  }
  return null
}

async function getContainerId(name) {
  const { status, body } = await dockerRequest('GET', `/containers/json?all=1&filters=${encodeURIComponent(JSON.stringify({ name: [name] }))}`)
  if (status !== 200) fail(`Docker API error (${status}) looking up container "${name}"`)
  // Body may be chunked-encoded — strip chunk sizes (hex length lines)
  const clean = body.replace(/^[0-9a-fA-F]+\r\n/gm, '').replace(/\r\n0\r\n.*/s, '').trim()
  const list = JSON.parse(clean)
  if (!list.length) fail(`Container "${name}" not found. Is Zitadel running?`)
  return list[0].Id
}

async function fetchLogs(containerId) {
  // timestamps=false, stdout=1, stderr=1 — get all logs since container start
  const { status, body } = await dockerRequest(
    'GET',
    `/containers/${containerId}/logs?stdout=1&stderr=1&timestamps=false&tail=5000`
  )
  if (status !== 200) fail(`Docker logs API returned ${status}`)
  // Docker multiplexed stream: each frame has an 8-byte header (stream type + length)
  // Strip these and return raw text.
  const buf = Buffer.from(body, 'binary')
  let text = ''
  let i = 0
  while (i + 8 <= buf.length) {
    const size = buf.readUInt32BE(i + 4)
    const payload = buf.slice(i + 8, i + 8 + size)
    text += payload.toString('utf8')
    i += 8 + size
  }
  return text
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`
${B}${C}  OpenWind — Zitadel Setup${R}
  ${'─'.repeat(40)}
`)

  // 1. Wait for Zitadel HTTP health
  log('  ⏳  Waiting for Zitadel to be healthy…')
  await waitForHealth()
  ok('Zitadel is up')
  info('Waiting 20s for first-boot setup to write PAT to logs…')
  await sleep(20_000)
  console.log()

  // 2. Find Zitadel container via Docker API
  log('  ⏳  Reading Zitadel startup logs…')
  const containerId = await getContainerId(ZITADEL_CTR_NAME)
  info(`Container ID: ${containerId.slice(0, 12)}`)

  // 3. Poll logs until PAT appears (first boot may still be writing)
  let pat = null
  for (let attempt = 1; attempt <= 20; attempt++) {
    const logs = await fetchLogs(containerId)
    pat = extractPat(logs)
    if (pat) break
    if (attempt % 5 === 0) info(`Still waiting for PAT in logs… (${attempt * 3}s)`)
    await sleep(3000)
  }

  if (!pat) {
    fail(`Could not find the machine user PAT in Zitadel's startup logs.

  Possible causes:
  • Zitadel was restarted after first boot — the PAT is only logged once.
    To regenerate: docker compose down -v && setup.bat (wipes Zitadel data)
  • The PAT was already used for a previous bootstrap.
    If you have a working .env.local with ZITADEL_KEY_JSON, just run:
      cd ../OpenWind && docker compose up -d

  Full Zitadel logs: docker compose logs zitadel`)
  }

  ok('PAT found in Zitadel startup logs')
  console.log()

  // 4. Print result
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
