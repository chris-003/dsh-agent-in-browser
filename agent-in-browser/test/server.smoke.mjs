// Standalone smoke test for the DSH-side WebSocket channel.
// Runs a real AgentInBrowserServer, connects a fake extension client, performs
// the token handshake, then drives a get_page command through server.send().
import WebSocket from 'ws'
import { AgentInBrowserServer } from '../lib/host/server.js'

const PORT = 39999
const TOKEN = 'agent-in-browser'

const server = new AgentInBrowserServer({ port: PORT, token: TOKEN, commandTimeoutMs: 5000 })
let resolveConnected
const connected = new Promise((resolve) => {
  resolveConnected = resolve
})
server.setCallbacks({
  onConnect: () => {
    console.log('[server] client connected')
    resolveConnected()
  },
  onDisconnect: () => console.log('[server] client disconnected'),
})
server.start()

const client = new WebSocket(`ws://127.0.0.1:${PORT}`)
client.on('open', () => {
  console.log('[client] open; sending hello')
  client.send(JSON.stringify({ type: 'hello', token: TOKEN, version: '1.0.0', actions: ['get_page'] }))
})
client.on('message', (raw) => {
  const frame = JSON.parse(String(raw))
  if (frame.type === 'command') {
    console.log(`[client] got command ${frame.action} (id=${frame.id})`)
    if (frame.action === 'get_page') {
      client.send(
        JSON.stringify({
          type: 'result',
          id: frame.id,
          ok: true,
          data: { url: 'https://example.com', title: 'Example', description: 'An example page', faviconUrl: null, selectedText: 'hello world' },
        }),
      )
    }
  }
})

await connected
try {
  const result = await server.send('get_page', {})
  console.log('[test] server.send ->', JSON.stringify(result, null, 2))
  if (result.title !== 'Example') throw new Error('unexpected title')
  console.log('[test] PASS')
} catch (err) {
  console.error('[test] FAIL', err.message)
  process.exitCode = 1
} finally {
  client.close()
  server.stop()
  process.exit(process.exitCode ?? 0)
}
