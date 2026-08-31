// Standalone smoke test for the dynamic bridge: spawns bridge-server.mjs,
// connects a fake extension client, feeds one command via the child's stdin,
// and reads the answer from its stdout.
import { spawn } from 'node:child_process'
import WebSocket from 'ws'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const PORT = 38888
const TOKEN = 'agent-in-browser'

const child = spawn(process.execPath, [join(here, 'bridge-server.mjs')], {
  env: { ...process.env, AIB_PORT: String(PORT), AIB_TOKEN: TOKEN },
  stdio: ['pipe', 'pipe', 'pipe'],
})

let stdoutBuf = ''
const stdoutDone = new Promise((resolve) => {
  child.stdout.on('data', (d) => {
    stdoutBuf += d.toString()
    if (stdoutBuf.split('\n').length > 1) resolve()
  })
})

// fake extension client (retry until the child is listening)
function tryConnect(attempt = 0) {
  return new Promise((resolve, reject) => {
    const client = new WebSocket(`ws://127.0.0.1:${PORT}`)
    const onOpen = () => {
      client.send(JSON.stringify({ type: 'hello', token: TOKEN, version: '1.0.0', actions: ['get_page'] }))
      resolve(client)
    }
    const onErr = () => {
      if (attempt < 20) {
        client.removeAllListeners()
        client.close()
        setTimeout(() => tryConnect(attempt + 1).then(resolve, reject), 150)
      } else reject(new Error('connect failed'))
    }
    client.once('open', onOpen)
    client.once('error', onErr)
  })
}

const client = await tryConnect()
client.on('message', (raw) => {
  const f = JSON.parse(String(raw))
  if (f.type === 'command' && f.action === 'get_page') {
    client.send(JSON.stringify({ type: 'result', id: f.id, ok: true, data: { url: 'https://example.com', title: 'Example', description: 'd', faviconUrl: null, selectedText: '' } }))
  }
})

await new Promise((r) => setTimeout(r, 200))
child.stdin.write(JSON.stringify({ id: 'c1', action: 'get_page', params: {} }) + '\n')

const out = await Promise.race([
  stdoutDone.then(() => stdoutBuf),
  new Promise((r) => setTimeout(() => r('TIMEOUT'), 4000)),
])
client.close()
child.kill()
console.log('[bridge-smoke] child stdout:', JSON.stringify(out.trim()))
const result = out.split('\n')[0]
if (result.includes('"ok":true') && result.includes('"title":"Example"')) {
  console.log('[bridge-smoke] PASS')
  process.exit(0)
} else {
  console.log('[bridge-smoke] FAIL')
  console.log('[bridge-smoke] child stderr available on next read')
  process.exit(1)
}
