#!/usr/bin/env node
// Standalone WebSocket server for the agent-in-browser channel.
//
// Used by two things:
//   1. The dynamic Cordis plugin ("for testing") spawns this via `subprocess`
//      with stdin/stdout piped; it bridges tool commands over stdio.
//   2. You can run it by hand to inspect the channel:  node bridge-server.mjs
//
// stdin protocol (JSON lines from the parent plugin / caller):
//   { id, action, params }   -> send a command over the WebSocket.
// stdout protocol (JSON lines):
//   { id, ok, data|error }   -> the extension's answer.
// stderr is used only for logging.
//
// The extension connects to ws://127.0.0.1:<port> and does the token handshake.
import { WebSocketServer } from 'ws'
import { createInterface } from 'node:readline'
import { DEFAULT_PORT, DEFAULT_TOKEN, PROTOCOL_VERSION } from '../lib/protocol/types.js'

const PORT = Number(process.env.AIB_PORT || DEFAULT_PORT)
const TOKEN = process.env.AIB_TOKEN || DEFAULT_TOKEN

const server = new WebSocketServer({ host: '127.0.0.1', port: PORT })
let socket = null
let connected = false
const pending = new Map()

function send(action, params, timeoutMs = 30000) {
  if (!connected || !socket) {
    return Promise.reject(new Error('agent-in-browser: browser is not connected. Load the Chrome extension and make sure it connects to this server.'))
  }
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`agent-in-browser: command "${action}" timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    pending.set(id, (ok, data, error) => {
      clearTimeout(timer)
      if (ok) resolve(data)
      else reject(new Error(error))
    })
    socket.send(JSON.stringify({ type: 'command', id, action, params }))
  })
}

server.on('connection', (socketIn) => {
  let authed = false
  socketIn.on('message', (raw) => {
    let frame
    try {
      frame = JSON.parse(String(raw))
    } catch {
      return
    }
    if (frame.type === 'ping') {
      socketIn.send(JSON.stringify({ type: 'pong' }))
      return
    }
    if (frame.type === 'pong') return
    if (frame.type === 'hello') {
      if (frame.token !== TOKEN) {
        socketIn.send(JSON.stringify({ type: 'result', id: '', ok: false, error: 'invalid token', code: 'AUTH' }))
        socketIn.close()
        return
      }
      authed = true
      socket = socketIn
      connected = true
      process.stderr.write(`[aib] browser connected (${frame.actions?.length ?? 0} actions)\n`)
      return
    }
    if (!authed) {
      socketIn.send(JSON.stringify({ type: 'result', id: frame.id ?? '', ok: false, error: 'not authenticated', code: 'AUTH' }))
      return
    }
    if (frame.type === 'result') {
      const resolve = pending.get(frame.id)
      if (!resolve) return
      pending.delete(frame.id)
      resolve(frame.ok, frame.data, frame.error)
      return
    }
  })
  socketIn.on('close', () => {
    if (socket === socketIn) socket = null
    connected = false
    process.stderr.write('[aib] browser disconnected\n')
  })
})

server.on('error', (err) => process.stderr.write(`[aib] server error: ${err.message}\n`))

// stdio bridge: read one JSON command per stdin line, write one JSON result per
// stdout line, in order.
const lines = createInterface({ input: process.stdin })
lines.on('line', (line) => {
  let cmd
  try {
    cmd = JSON.parse(line)
  } catch {
    return
  }
  send(cmd.action, cmd.params ?? {})
    .then((data) => process.stdout.write(JSON.stringify({ id: cmd.id, ok: true, data }) + '\n'))
    .catch((err) => process.stdout.write(JSON.stringify({ id: cmd.id, ok: false, error: String(err?.message ?? err) }) + '\n'))
})

process.stderr.write(`[aib] listening on ws://127.0.0.1:${PORT} (token ${TOKEN})\n`)
void PROTOCOL_VERSION
