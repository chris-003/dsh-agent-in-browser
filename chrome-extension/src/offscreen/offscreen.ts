// Offscreen document: ONLY a canvas crop utility for region screenshots.
// The persistent WebSocket lives in the service worker; this document is
// created on demand when the SW needs to crop a captured screenshot region.
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
