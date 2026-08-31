// WebSocket server (DSH side) that the Chrome extension connects to.
import { WebSocketServer } from 'ws'
import { PROTOCOL_VERSION } from '../protocol/types.js'

export class AgentInBrowserServer {
  constructor(opts = {}) {
    this.host = opts.host ?? '127.0.0.1'
    this.port = opts.port
    this.token = opts.token
    this.commandTimeoutMs = opts.commandTimeoutMs ?? 30000
    this.server = null
    this.socket = null
    this.pending = new Map()
    this.connected = false
    this.lastSeen = 0
    this.callbacks = {}
  }

  setCallbacks(cb = {}) {
    this.callbacks = cb
  }

  get isConnected() {
    return this.connected
  }

  // Apply new effective config and rebind (stop+start) if any listener-facing
  // field changed. Returns whether a rebind happened. Reusing the same object
  // keeps any `send`-bound tool closures valid across config changes.
  applyConfig(opts = {}) {
    const next = {
      host: opts.host ?? this.host,
      port: opts.port ?? this.port,
      token: opts.token ?? this.token,
      commandTimeoutMs: opts.commandTimeoutMs ?? this.commandTimeoutMs,
    }
    const changed =
      next.host !== this.host ||
      next.port !== this.port ||
      next.token !== this.token ||
      next.commandTimeoutMs !== this.commandTimeoutMs
    Object.assign(this, next)
    if (changed && this.server) {
      this.stop()
      this.start()
    }
    return changed
  }

  start() {
    if (this.server) return
    this.server = new WebSocketServer({ host: this.host, port: this.port })
    this.server.on('connection', (socket) => this.onSocket(socket))
    this.server.on('error', () => this.callbacks.onDisconnect?.())
  }

  stop() {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer)
      p.reject(new Error('agent-in-browser: server stopped'))
    }
    this.pending.clear()
    if (this.socket) this.socket.close()
    this.socket = null
    this.connected = false
    if (this.server) this.server.close()
    this.server = null
  }

  async send(action, params, timeoutMs = this.commandTimeoutMs) {
    if (!this.connected || !this.socket) {
      throw new Error(
        'agent-in-browser: browser is not connected. Load the Chrome extension and make sure it connects to this server, then retry.',
      )
    }
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`agent-in-browser: command "${action}" timed out after ${timeoutMs}ms`))
      }, timeoutMs)
      this.pending.set(id, {
        resolve: (data) => {
          clearTimeout(timer)
          resolve(data)
        },
        reject: (err) => {
          clearTimeout(timer)
          reject(err)
        },
      })
      this.socket.send(JSON.stringify({ type: 'command', id, action, params }))
    })
  }

  onSocket(socket) {
    let authed = false
    socket.on('message', (raw) => {
      let frame
      try {
        frame = JSON.parse(String(raw))
      } catch {
        return
      }
      if (frame.type === 'ping') {
        socket.send(JSON.stringify({ type: 'pong' }))
        return
      }
      if (frame.type === 'pong') {
        this.lastSeen = Date.now()
        return
      }
      if (frame.type === 'hello') {
        if (frame.token !== this.token) {
          socket.send(JSON.stringify({ type: 'result', id: '', ok: false, error: 'invalid token', code: 'AUTH' }))
          socket.close()
          return
        }
        authed = true
        this.socket = socket
        this.connected = true
        this.lastSeen = Date.now()
        this.callbacks.onConnect?.()
        return
      }
      if (!authed) {
        socket.send(JSON.stringify({ type: 'result', id: frame.id ?? '', ok: false, error: 'not authenticated', code: 'AUTH' }))
        return
      }
      if (frame.type === 'result') {
        const pending = this.pending.get(frame.id)
        if (!pending) return
        this.pending.delete(frame.id)
        if (frame.ok) pending.resolve(frame.data)
        else pending.reject(new Error(frame.error ?? 'agent-in-browser: command failed'))
        return
      }
      if (frame.type === 'event') {
        this.callbacks.onEvent?.(frame.event, frame.data)
        return
      }
    })
    socket.on('close', () => {
      if (this.socket === socket) this.socket = null
      this.connected = false
      if (authed) this.callbacks.onDisconnect?.()
    })
    socket.on('error', () => {
      if (this.socket === socket) this.socket = null
      this.connected = false
    })
  }
}
