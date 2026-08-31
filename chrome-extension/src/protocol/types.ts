// Mirror of `agent-in-browser/lib/protocol/types.js` (canonical contract).
// The extension cannot import the DSH package at runtime, so this copy must be
// kept in sync. Only the constants/enums actually matter at runtime; the
// interfaces are for type checking.
export const ACTION_NAMES = [
  'get_page',
  'read_page',
  'extract',
  'find_element',
  'list_tabs',
  'activate_tab',
  'open_tab',
  'close_tab',
  'screenshot',
  'click',
  'type',
  'scroll',
  'navigate',
  'press',
  'select',
  'wait',
  'storage_get',
  'storage_set',
  'copy',
] as const

export type ActionName = (typeof ACTION_NAMES)[number]

export const DEFAULT_PORT = 38745
export const DEFAULT_TOKEN = 'agent-in-browser'
export const PROTOCOL_VERSION = '1.0.0'
export const DEFAULT_SERVER_URL = `ws://127.0.0.1:${DEFAULT_PORT}`

export interface HelloFrame {
  type: 'hello'
  token: string
  version: string
  actions: string[]
}
export interface CommandFrame {
  type: 'command'
  id: string
  action: ActionName
  params: Record<string, unknown>
}
export interface ResultFrame {
  type: 'result'
  id: string
  ok: boolean
  data?: unknown
  error?: string
  code?: string
}
export interface PingFrame { type: 'ping' }
export interface PongFrame { type: 'pong' }
export type Frame = HelloFrame | CommandFrame | ResultFrame | PingFrame | PongFrame

export interface TabInfo {
  id: number
  title: string
  url: string
  faviconUrl: string | null
  active: boolean
  windowId: number
}

export interface GetPageResult {
  url: string
  title: string
  description: string
  faviconUrl: string | null
  selectedText: string
}
