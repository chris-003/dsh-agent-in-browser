// Firefox MV2 background page: owns the persistent WebSocket to the DSH server
// and the command router / tab, window, and DOM action handlers. Unlike Chrome's
// MV3 service worker, this is a persistent DOM page, so it can do the
// region-screenshot canvas crop directly (no offscreen document needed) and the
// WebSocket stays alive for as long as the background page is loaded.
import browser from 'webextension-polyfill'
import {
  ACTION_NAMES,
  DEFAULT_SERVER_URL,
  DEFAULT_TOKEN,
  PROTOCOL_VERSION,
  type CommandFrame,
  type ResultFrame,
  type TabInfo,
  type GetPageResult,
  type ScreenshotResult,
} from '../protocol/types'

// ---------------------------------------------------------------------------
// WebSocket client. The background page (persistent: true) keeps the channel
// open; there is no service-worker lifecycle to keep alive.
// ---------------------------------------------------------------------------

let ws: WebSocket | null = null
let reconnectDelay = 1000
let heartbeat: ReturnType<typeof setInterval> | null = null

function setStatus(conn: 'connecting' | 'connected' | 'disconnected' | 'error', error?: string) {
  void browser.storage.local.set({ connected: conn === 'connected', status: conn, ...(error ? { lastError: error } : {}) })
}

async function connectToServer() {
  const cfg = await browser.storage.local.get(['serverUrl', 'token'])
  const url = (cfg.serverUrl as string) || DEFAULT_SERVER_URL
  const token = (cfg.token as string) || DEFAULT_TOKEN

  setStatus('connecting')
  let socket: WebSocket
  try {
    socket = new WebSocket(url)
  } catch (e: any) {
    setStatus('error', String(e?.message ?? e))
    return
  }
  ws = socket

  socket.onopen = () => {
    reconnectDelay = 1000
    clearInterval(heartbeat ?? undefined)
    heartbeat = setInterval(() => ws?.send(JSON.stringify({ type: 'ping' })), 25000)
    socket.send(
      JSON.stringify({
        type: 'hello',
        token,
        version: PROTOCOL_VERSION,
        actions: [...ACTION_NAMES],
      }),
    )
    setStatus('connected')
    void browser.storage.local.set({ serverUrl: url })
  }

  socket.onmessage = (ev) => {
    let frame: any
    try {
      frame = JSON.parse(ev.data)
    } catch {
      return
    }
    if (frame.type === 'ping') {
      socket.send(JSON.stringify({ type: 'pong' }))
      return
    }
    if (frame.type === 'command') {
      dispatch(frame as CommandFrame).then((res) => {
        try {
          socket.send(JSON.stringify(res))
        } catch {}
      })
    }
  }

  socket.onclose = () => {
    clearInterval(heartbeat ?? undefined)
    heartbeat = null
    setStatus('disconnected')
    console.warn(`[agent-in-browser] socket closed (${url}); reconnecting in ${reconnectDelay}ms`)
    setTimeout(() => void connectToServer(), reconnectDelay)
    reconnectDelay = Math.min(reconnectDelay * 2, 15000)
  }
  socket.onerror = (ev: Event) => {
    const msg = (ev as any)?.message ?? (ev as any)?.error?.message ?? 'WebSocket error'
    setStatus('error', String(msg))
    console.error('[agent-in-browser] connection error:', msg)
    try { socket.close() } catch {}
  }
}

function reconnectNow() {
  const old = ws
  ws = null
  try { old?.close() } catch {}
  void connectToServer()
}

// The active tab as callers actually read it: `id` is guaranteed present (we
// threw otherwise), the rest are optional like the polyfill's `tabs.Tab`.
type ActiveTab = { id: number; url?: string; title?: string; favIconUrl?: string | null; windowId?: number }

async function activeTabId(): Promise<ActiveTab> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id) throw new Error('no active tab found')
  return { id: tab.id, url: tab.url, title: tab.title, favIconUrl: tab.favIconUrl as string | null | undefined, windowId: tab.windowId }
}

// Inject a self-contained function into the page. Firefox's tabs.executeScript
// only accepts a `code` string (no `func`/`args`), so serialize the function
// body into an IIFE expression. The last expression's value is returned.
async function runScript<T>(tabId: number, func: (...args: any[]) => T, args: unknown[] = []): Promise<T | undefined> {
  const code = `(${func.toString()}).apply(null, ${JSON.stringify(args)})`
  const results = (await browser.tabs.executeScript(tabId, { code })) as any[]
  return results?.[0]?.result as T | undefined
}

//--------------------------------------------------------------------------------
// A. page information (self-contained page scripts)
//--------------------------------------------------------------------------------

const readPageBody = () => {
  const desc = document.querySelector('meta[name="description"]')?.getAttribute('content') ?? ''
  const icon =
    document.querySelector('link[rel~="icon"]')?.getAttribute('href') ??
    document.querySelector('link[rel="icon"]')?.getAttribute('href') ??
    ''
  const selected = window.getSelection()?.toString() ?? ''
  return { description: desc, favicon: icon, selectedText: selected }
}

const readBody = (p: any) => {
  const text = (document.body?.innerText ?? '').trim()
  const max = Number(p.maxLength) > 0 ? Number(p.maxLength) : 8000
  let links: { href: string; text: string }[] | undefined
  if (p.includeLinks) links = [...document.querySelectorAll('a')].slice(0, 50).map((a) => ({ href: a.href, text: a.textContent?.trim() ?? '' }))
  return { text: text.slice(0, max), truncated: text.length > max, links }
}

const extractBody = (p: any) => {
  const what = p.what ?? 'all'
  const out: any = {}
  if (what === 'links' || what === 'all')
    out.links = [...document.querySelectorAll('a')].slice(0, 200).map((a) => ({
      href: a.href,
      text: a.textContent?.trim() ?? '',
      ariaLabel: a.getAttribute('aria-label') ?? undefined,
    }))
  if (what === 'images' || what === 'all')
    out.images = [...document.querySelectorAll('img')].slice(0, 200).map((i) => ({ src: i.src, alt: i.alt }))
  if (what === 'meta' || what === 'all') {
    out.meta = {}
    for (const m of document.querySelectorAll('meta[name],meta[property],meta[content]')) {
      const k = m.getAttribute('name') ?? m.getAttribute('property')
      if (k) out.meta[k] = m.getAttribute('content')
    }
  }
  if (what === 'forms' || what === 'all')
    out.forms = [...document.querySelectorAll('input,select,textarea')].slice(0, 200).map((i: any) => ({
      name: i.name ?? '',
      type: i.type ?? i.tagName,
      value: i.value ?? '',
      label: i.labels?.[0]?.textContent?.trim() ?? i.getAttribute('aria-label') ?? '',
    }))
  return out
}

const findBody = (p: any) => {
  const find = (): Element | null => {
    if (p.selector) return document.querySelector(p.selector)
    if (p.text) {
      const q = p.text.trim()
      return [...document.querySelectorAll('a,button,input,select,textarea,label,div,span,li')].find(
        (el) => el.textContent?.trim() === q || el.textContent?.includes(q),
      ) ?? null
    }
    if (p.role) return [...document.querySelectorAll(`[role="${p.role}"]`)][0] ?? null
    if (p.ariaLabel) return document.querySelector(`[aria-label="${p.ariaLabel}"]`)
    return null
  }
  const el = find()
  if (!el) return { found: false }
  const r = (el as HTMLElement).getBoundingClientRect()
  const attrs: Record<string, string> = {}
  for (const a of el.attributes) attrs[a.name] = a.value
  return {
    found: true,
    tag: el.tagName.toLowerCase(),
    text: el.textContent?.trim().slice(0, 200) ?? '',
    boundingBox: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) },
    attributes: attrs,
  }
}

async function handleGetPage(): Promise<GetPageResult> {
  const tab = await activeTabId()
  const fallback: GetPageResult = {
    url: tab.url ?? '',
    title: tab.title ?? '',
    description: '',
    faviconUrl: (tab.favIconUrl as string | null) ?? null,
    selectedText: '',
  }
  try {
    const r = await runScript(tab.id, readPageBody)
    return {
      url: tab.url ?? '',
      title: tab.title ?? '',
      description: r?.description ?? '',
      faviconUrl: r?.favicon || fallback.faviconUrl,
      selectedText: r?.selectedText ?? '',
    }
  } catch {
    return fallback
  }
}

//--------------------------------------------------------------------------------
// D. tabs / windows
//--------------------------------------------------------------------------------

async function handleListTabs() {
  const tabs = await browser.tabs.query({})
  const mapped: TabInfo[] = tabs.map((t) => ({
    id: t.id ?? -1,
    title: t.title ?? '',
    url: t.url ?? '',
    faviconUrl: (t.favIconUrl as string | null) ?? null,
    active: t.active ?? false,
    windowId: t.windowId ?? -1,
  }))
  const activeWindow = await browser.windows.getCurrent()
  const active = mapped.find((t) => t.active && t.windowId === activeWindow.id) ?? mapped.find((t) => t.active) ?? null
  return { tabs: mapped, active }
}

async function handleActivateTab(tabId: number) {
  const tab = await browser.tabs.get(tabId)
  await browser.tabs.update(tabId, { active: true })
  if (tab.windowId) await browser.windows.update(tab.windowId, { focused: true })
  return { ok: true }
}

async function handleOpenTab(url: string, active = true) {
  if (!/^[a-z]+:\/\//i.test(url)) url = 'https://' + url
  const t = await browser.tabs.create({ url, active })
  return {
    tab: {
      id: t.id ?? -1,
      title: t.title ?? '',
      url: t.url ?? url,
      faviconUrl: (t.favIconUrl as string | null) ?? null,
      active: t.active ?? active,
      windowId: t.windowId ?? -1,
    } as TabInfo,
  }
}

async function handleCloseTab(tabId: number) {
  await browser.tabs.remove(tabId)
  return { ok: true }
}

//--------------------------------------------------------------------------------
// B. screenshots
//--------------------------------------------------------------------------------

/** Strip the `data:` prefix from a data URL, leaving the raw base64 payload. */
function dataUrlToBase64(dataUrl: string) {
  return dataUrl.split(',')[1] ?? ''
}

/** Decode a data URL and crop the given region, returning base64 PNG (no prefix). */
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

async function handleScreenshotVisible(format: 'png' | 'jpeg', quality?: number): Promise<ScreenshotResult> {
  const win = await browser.windows.getCurrent()
  const dataUrl = await browser.tabs.captureVisibleTab(win.id!, { format, quality })
  const image = dataUrlToBase64(dataUrl)
  return { image, mime: format === 'jpeg' ? 'image/jpeg' : 'image/png', bytes: Math.floor(image.length * 3 / 4), width: 0, height: 0 }
}

async function handleScreenshotFull(format: 'png' | 'jpeg', quality?: number): Promise<ScreenshotResult> {
  // Firefox has no native full-page capture (no Page.captureScreenshot with
  // captureBeyondViewport via this API). Capture the visible area instead and
  // flag the degradation so the caller can warn the user.
  const base = await handleScreenshotVisible(format, quality)
  return { ...base, note: 'Firefox 不支持整页抓取，已降级为可见区域截图。' }
}

async function handleScreenshotRegion(regionSelector: string, format: 'png' | 'jpeg', quality?: number): Promise<ScreenshotResult> {
  const tab = await activeTabId()
  const bounds = await runScript(tab.id, (selector: string) => {
    const el = document.querySelector(selector)
    if (!el) return null
    const r = (el as HTMLElement).getBoundingClientRect()
    return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }
  }, [regionSelector])
  if (!bounds) throw new Error(`region selector matched nothing: ${regionSelector}`)
  const win = await browser.windows.getCurrent()
  const dataUrl = await browser.tabs.captureVisibleTab(win.id!, { format, quality })
  const image = await cropImage(dataUrl, bounds.x, bounds.y, bounds.width, bounds.height)
  return { image, mime: 'image/png', bytes: Math.floor(image.length * 3 / 4), width: bounds.width, height: bounds.height }
}

//--------------------------------------------------------------------------------
// C. interaction (page scripts)
//--------------------------------------------------------------------------------

const clickBody = (p: any) => {
  const find = (): Element | null => {
    if (p.selector) return document.querySelector(p.selector)
    if (p.text) {
      const q = p.text.trim()
      return [...document.querySelectorAll('a,button,input,select,textarea,label,div,span,li')].find(
        (el) => el.textContent?.trim() === q || el.textContent?.includes(q),
      ) ?? null
    }
    if (p.ariaLabel) return document.querySelector(`[aria-label="${p.ariaLabel}"]`)
    return null
  }
  let el = find()
  if (!el && p.x !== undefined && p.y !== undefined) el = document.elementFromPoint(p.x, p.y)
  if (!el) return { ok: false, error: 'no matching element found' }
  ;(el as HTMLElement).scrollIntoView({ block: 'center', inline: 'center' })
  ;(el as HTMLElement).click()
  return { ok: true }
}

const typeBody = (p: any) => {
  const el = (p.selector ? document.querySelector(p.selector) : document.activeElement) as HTMLInputElement | null
  if (!el) return { ok: false, error: 'no input element to type into' }
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set
  if (p.clear !== false) {
    if (setter) setter.call(el, '')
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }
  if (setter) setter.call(el, String(p.text ?? ''))
  else el.value = String(p.text ?? '')
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
  if (p.pressEnter) el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
  return { ok: true }
}

const scrollBody = (p: any) => {
  const el = (p.selector ? document.querySelector(p.selector) : null) as HTMLElement | null
  const target = (el || document.scrollingElement || document.documentElement) as HTMLElement
  if (p.to === 'top') target.scrollTop = 0
  else if (p.to === 'bottom') target.scrollTop = target.scrollHeight
  else if (typeof p.by === 'number') target.scrollTop += p.by
  else if (typeof p.ratio === 'number') target.scrollTop = p.ratio * target.scrollHeight
  return { ok: true }
}

const pressBody = (p: any) => {
  const el = (p.selector ? document.querySelector(p.selector) : null) as HTMLElement | null
  const target = el || (document.activeElement as HTMLElement | null) || document.body
  const keys = Array.isArray(p.keys) ? p.keys : String(p.keys ?? '').split(',')
  const mods = /ctrl|control/i
  for (const raw of keys) {
    const key = raw.trim()
    if (!key) continue
    const low = key.toLowerCase()
    const ctrl = mods.test(low) || false
    const opts = { key, bubbles: true, cancelable: true, ctrlKey: ctrl, metaKey: ctrl, shiftKey: false, altKey: false }
    target.dispatchEvent(new KeyboardEvent('keydown', opts))
    target.dispatchEvent(new KeyboardEvent('keyup', opts))
  }
  return { ok: true }
}

const selectBody = (p: any) => {
  const el = document.querySelector(p.selector) as HTMLElement | null
  if (!el) return { ok: false, error: 'selector matched nothing' }
  if (p.type === 'check') {
    const box = el as HTMLInputElement
    if (box.type === 'checkbox' || box.type === 'radio') {
      box.checked = !box.checked
      box.dispatchEvent(new Event('change', { bubbles: true }))
    }
    return { ok: true }
  }
  const sel = el as HTMLSelectElement
  if (sel.tagName === 'SELECT' && p.value !== undefined) {
    sel.value = p.value
    sel.dispatchEvent(new Event('change', { bubbles: true }))
  }
  return { ok: true }
}

const copyBody = (p: any) => {
  const ta = document.createElement('textarea')
  ta.value = String(p.text ?? '')
  ta.style.position = 'fixed'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  ta.select()
  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch {
    ok = false
  }
  ta.remove()
  return { ok }
}

//--------------------------------------------------------------------------------

async function handleNavigate(p: any) {
  const where = p.where ?? 'current'
  if (where === 'back') {
    const tab = await activeTabId()
    await browser.tabs.goBack(tab.id)
    const t = await browser.tabs.get(tab.id)
    return { url: t.url ?? '', title: t.title ?? '' }
  }
  if (where === 'forward') {
    const tab = await activeTabId()
    await browser.tabs.goForward(tab.id)
    const t = await browser.tabs.get(tab.id)
    return { url: t.url ?? '', title: t.title ?? '' }
  }
  if (where === 'reload') {
    const tab = await activeTabId()
    await browser.tabs.reload(tab.id)
    return { url: tab.url ?? '', title: tab.title ?? '' }
  }
  if (where === 'new') {
    const res = await handleOpenTab(p.url ?? 'about:blank', true)
    return { url: res.tab.url, title: res.tab.title }
  }
  const tab = await activeTabId()
  let url = String(p.url ?? '')
  if (!/^[a-z]+:\/\//i.test(url)) url = 'https://' + url
  url = url || tab.url || ''
  await browser.tabs.update(tab.id, { url })
  return { url, title: tab.title ?? '' }
}

async function dispatch(frame: CommandFrame): Promise<ResultFrame> {
  const { id, action, params } = frame
  const p = params as any
  try {
    let data: unknown
    const format: 'png' | 'jpeg' = p.format === 'jpeg' ? 'jpeg' : 'png'
    switch (action) {
      case 'get_page':
        data = await handleGetPage()
        break
      case 'read_page': {
        const tab = await activeTabId()
        data = await runScript(tab.id, readBody, [p])
        break
      }
      case 'extract': {
        const tab = await activeTabId()
        data = await runScript(tab.id, extractBody, [p])
        break
      }
      case 'find_element': {
        const tab = await activeTabId()
        data = await runScript(tab.id, findBody, [p])
        break
      }
      case 'list_tabs':
        data = await handleListTabs()
        break
      case 'activate_tab':
        data = await handleActivateTab(Number(p.tabId))
        break
      case 'open_tab':
        data = await handleOpenTab(String(p.url), p.active !== false)
        break
      case 'close_tab':
        data = await handleCloseTab(Number(p.tabId))
        break
      case 'screenshot': {
        const mode = p.mode ?? 'visible'
        if (mode === 'full') data = await handleScreenshotFull(format, p.quality)
        else if (mode === 'region') data = await handleScreenshotRegion(String(p.regionSelector), format, p.quality)
        else data = await handleScreenshotVisible(format, p.quality)
        break
      }
      case 'click': {
        const tab = await activeTabId()
        data = await runScript(tab.id, clickBody, [p])
        break
      }
      case 'type': {
        const tab = await activeTabId()
        data = await runScript(tab.id, typeBody, [p])
        break
      }
      case 'scroll': {
        const tab = await activeTabId()
        data = await runScript(tab.id, scrollBody, [p])
        break
      }
      case 'navigate':
        data = await handleNavigate(p)
        break
      case 'press': {
        const tab = await activeTabId()
        data = await runScript(tab.id, pressBody, [p])
        break
      }
      case 'select': {
        const tab = await activeTabId()
        data = await runScript(tab.id, selectBody, [p])
        break
      }
      case 'wait': {
        // Wait for a condition by polling the page.
        const tab = await activeTabId()
        const timeout = Number(p.timeoutMs) > 0 ? Number(p.timeoutMs) : 10000
        const start = Date.now()
        let satisfied = false
        while (Date.now() - start < timeout) {
          satisfied = (await runScript(tab.id, (cond: any) => {
            if (cond.condition === 'selector') return !!document.querySelector(cond.selector)
            if (cond.condition === 'text') return (document.body?.innerText ?? '').includes(cond.text)
            if (cond.condition === 'url') return location.href.includes(cond.url)
            if (cond.condition === 'timeout') return true
            return false
          }, [p])) as boolean
          if (satisfied) break
          await new Promise((r) => setTimeout(r, 250))
        }
        if (!satisfied && p.condition !== 'timeout') throw new Error(`wait condition "${p.condition}" not satisfied within ${timeout}ms`)
        data = { ok: true }
        break
      }
      case 'storage_get':
        data = { values: p.keys ? await browser.storage.local.get(p.keys) : await browser.storage.local.get(null) }
        break
      case 'storage_set':
        await browser.storage.local.set(p.values ?? {})
        data = { ok: true }
        break
      case 'copy': {
        const tab = await activeTabId()
        data = await runScript(tab.id, copyBody, [p])
        break
      }
      default:
        throw new Error(`unsupported action: ${action}`)
    }
    return { type: 'result', id, ok: true, data }
  } catch (err: any) {
    return { type: 'result', id, ok: false, error: String(err?.message ?? err), code: 'EXEC' }
  }
}

browser.runtime.onMessage.addListener((msg: any, _sender, sendResponse) => {
  // Respond synchronously via sendResponse; returning true keeps the channel
  // open until sendResponse is called, which is the polyfill's documented pattern.
  if (msg && msg.kind === 'RECONNECT') {
    reconnectNow()
    sendResponse({ ok: true })
    return true
  }
  if (msg && msg.kind === 'PING') {
    sendResponse({ ok: true })
    return true
  }
  return true
})

browser.runtime.onInstalled.addListener(() => void connectToServer())
browser.runtime.onStartup.addListener(() => void connectToServer())
void connectToServer()
