// MV3 service worker: command router and tab/window-level action handlers.
// Receives frames from the offscreen WebSocket holder, executes them, and
// returns a result. The offscreen document holds the actual socket.
import {
  type CommandFrame,
  type ResultFrame,
  type ActionName,
  type GetPageResult,
  type TabInfo,
} from '../protocol/types'

const OFFSCREEN_URL = 'offscreen.html'

async function ensureOffscreen() {
  if (chrome.offscreen && typeof chrome.offscreen.hasDocument === 'function') {
    const has = await chrome.offscreen.hasDocument()
    if (has) return
  }
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ['WORKERS'],
    justification: 'Hold a persistent WebSocket connection to the agent-in-browser server.',
  })
}

// Wrap a plain function into a serializable chrome.scripting injected function
// body. Chrome requires either a file path or a single function; we use func.
const readPageBody = () => {
  const desc = document.querySelector('meta[name="description"]')?.getAttribute('content') ?? ''
  const icon =
    document.querySelector('link[rel~="icon"]')?.getAttribute('href') ??
    document.querySelector('link[rel="icon"]')?.getAttribute('href') ??
    ''
  const selected = window.getSelection()?.toString() ?? ''
  return { description: desc, favicon: icon, selectedText: selected }
}

async function handleGetPage(): Promise<GetPageResult> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  const fallback = {
    url: tab?.url ?? '',
    title: tab?.title ?? '',
    description: '',
    faviconUrl: (tab?.favIconUrl as string | null) ?? null,
    selectedText: '',
  }
  if (!tab?.id) return fallback
  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: readPageBody,
    })
    const r = res?.result as { description?: string; favicon?: string; selectedText?: string } | undefined
    return {
      url: tab.url ?? '',
      title: tab.title ?? '',
      description: r?.description ?? '',
      faviconUrl: r?.favicon || fallback.faviconUrl,
      selectedText: r?.selectedText ?? '',
    }
  } catch {
    // Restricted page (chrome://, Web Store, etc.): return tab metadata only.
    return fallback
  }
}

async function handleListTabs(): Promise<{ tabs: TabInfo[]; active: TabInfo | null }> {
  const tabs = await chrome.tabs.query({})
  const mapped: TabInfo[] = tabs.map((t) => ({
    id: t.id ?? -1,
    title: t.title ?? '',
    url: t.url ?? '',
    faviconUrl: (t.favIconUrl as string | null) ?? null,
    active: t.active ?? false,
    windowId: t.windowId,
  }))
  const activeWindow = await chrome.windows.getCurrent()
  const active =
    mapped.find((t) => t.active && t.windowId === activeWindow.id) ?? mapped.find((t) => t.active) ?? null
  return { tabs: mapped, active }
}

async function handleActivateTab(tabId: number): Promise<{ ok: boolean }> {
  const tab = await chrome.tabs.get(tabId)
  await chrome.tabs.update(tabId, { active: true })
  if (tab.windowId) await chrome.windows.update(tab.windowId, { focused: true })
  return { ok: true }
}

async function handleOpenTab(url: string, active = true): Promise<{ tab: TabInfo }> {
  const t = await chrome.tabs.create({ url, active })
  return {
    tab: {
      id: t.id ?? -1,
      title: t.title ?? '',
      url: t.url ?? url,
      faviconUrl: (t.favIconUrl as string | null) ?? null,
      active: t.active ?? active,
      windowId: t.windowId,
    },
  }
}

async function handleCloseTab(tabId: number): Promise<{ ok: boolean }> {
  await chrome.tabs.remove(tabId)
  return { ok: true }
}

async function dispatch(frame: CommandFrame): Promise<ResultFrame> {
  const { id, action, params } = frame
  try {
    let data: unknown
    switch (action) {
      case 'get_page':
        data = await handleGetPage()
        break
      case 'list_tabs':
        data = await handleListTabs()
        break
      case 'activate_tab':
        data = await handleActivateTab(Number((params as any).tabId))
        break
      case 'open_tab':
        data = await handleOpenTab(String((params as any).url), Boolean((params as any).active))
        break
      case 'close_tab':
        data = await handleCloseTab(Number((params as any).tabId))
        break
      default:
        throw new Error(`action "${action}" is not implemented yet (scheduled for M3)`)
    }
    return { type: 'result', id, ok: true, data }
  } catch (err: any) {
    return { type: 'result', id, ok: false, error: String(err?.message ?? err), code: 'EXEC' }
  }
}

chrome.runtime.onMessage.addListener((msg: any, _sender, sendResponse) => {
  if (!msg || msg.type !== 'AIRBY') return false
  if (msg.frame && msg.frame.type === 'command') {
    dispatch(msg.frame as CommandFrame).then(
      (r) => sendResponse(r),
      (e: any) =>
        sendResponse({ type: 'result', id: msg.frame.id, ok: false, error: String(e?.message ?? e), code: 'EXEC' }),
    )
    return true
  }
  if (msg.kind === 'PING') {
    sendResponse({ ok: true })
    return false
  }
  return false
})

// Create the offscreen document so it can hold the socket, and reconnect the
// socket when config changes (M3 wires options; M1 uses defaults).
chrome.runtime.onInstalled.addListener(() => void ensureOffscreen())
chrome.runtime.onStartup.addListener(() => void ensureOffscreen())
void ensureOffscreen()
