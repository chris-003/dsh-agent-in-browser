// Offscreen document: holds the persistent WebSocket to the DSH server and
// relays command frames to the service worker for execution.
import {
  ACTION_NAMES,
  DEFAULT_SERVER_URL,
  DEFAULT_TOKEN,
  PROTOCOL_VERSION,
  type CommandFrame,
  type ResultFrame,
} from '../protocol/types'

interface StoredConfig {
  serverUrl?: string
  token?: string
}

let ws: WebSocket | null = null
let reconnectDelay = 1000
let stopped = false

async function readConfig(): Promise<StoredConfig> {
  try {
    return (await chrome.storage.local.get(['serverUrl', 'token'])) as StoredConfig
  } catch {
    return {}
  }
}

async function connect() {
  if (stopped) return
  const cfg = await readConfig()
  const url = cfg.serverUrl || DEFAULT_SERVER_URL
  const token = cfg.token || DEFAULT_TOKEN

  ws = new WebSocket(url)

  ws.onopen = () => {
    reconnectDelay = 1000
    ws?.send(
      JSON.stringify({
        type: 'hello',
        token,
        version: PROTOCOL_VERSION,
        actions: [...ACTION_NAMES],
      }),
    )
  }

  ws.onmessage = (ev) => {
    let frame: any
    try {
      frame = JSON.parse(ev.data)
    } catch {
      return
    }
    if (frame.type === 'ping') {
      ws?.send(JSON.stringify({ type: 'pong' }))
      return
    }
    if (frame.type === 'command') {
      void dispatch(frame as CommandFrame)
    }
  }

  ws.onclose = () => {
    if (stopped) return
    setTimeout(() => void connect(), reconnectDelay)
    reconnectDelay = Math.min(reconnectDelay * 2, 15000)
  }
  ws.onerror = () => {
    ws?.close()
  }
}

async function dispatch(frame: CommandFrame): Promise<void> {
  const result = await run(frame)
  ws?.send(JSON.stringify(result))
}

async function run(frame: CommandFrame): Promise<ResultFrame> {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'AIRBY', frame })
    if (response && typeof response.ok !== 'undefined') {
      return { type: 'result', id: frame.id, ok: response.ok, data: response.data, error: response.error }
    }
    return { type: 'result', id: frame.id, ok: false, error: 'no response from service worker' }
  } catch (err: any) {
    return { type: 'result', id: frame.id, ok: false, error: String(err?.message ?? err), code: 'EXEC' }
  }
}

// Reconnect if the DSH server URL/token changes.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return
  if (changes.serverUrl || changes.token) {
    ws?.close()
  }
})

// Utility requests from the service worker (e.g. crop a visible screenshot).
chrome.runtime.onMessage.addListener((msg: any, _sender, sendResponse) => {
  if (!msg || msg.kind !== 'util') return false
  if (msg.util === 'crop') {
    cropImage(msg.dataUrl, msg.x, msg.y, msg.width, msg.height)
      .then((base64) => sendResponse({ ok: true, data: base64 }))
      .catch((e: any) => sendResponse({ ok: false, error: String(e?.message ?? e) }))
    return true
  }
  return false
})

/** Decode a data URL and crop the given region, returning the base64 PNG. */
function cropImage(dataUrl: string, x: number, y: number, width: number, height: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('no canvas 2d context'))
        return
      }
      ctx.drawImage(img, x, y, width, height, 0, 0, width, height)
      resolve(canvas.toDataURL('image/png').split(',')[1] ?? '')
    }
    img.onerror = () => reject(new Error('failed to decode screenshot'))
    img.src = dataUrl
  })
}

void connect()
