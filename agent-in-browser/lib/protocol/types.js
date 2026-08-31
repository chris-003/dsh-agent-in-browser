// Shared wire protocol between the DeepSeek Harness side
// (@chris-003/agent-in-browser host plugin) and the Chrome extension.
// Plain JS mirror of `chrome-extension/src/protocol/types.ts`; keep in sync.

export const ACTION_NAMES = [
  // A. page information
  'get_page',
  'read_page',
  'extract',
  'find_element',
  // D. tabs / windows
  'list_tabs',
  'activate_tab',
  'open_tab',
  'close_tab',
  // B. screenshots
  'screenshot',
  // C. interaction
  'click',
  'type',
  'scroll',
  'navigate',
  'press',
  'select',
  'wait',
  // E. misc
  'storage_get',
  'storage_set',
  'copy',
]

export const DEFAULT_PORT = 38745
export const DEFAULT_TOKEN = 'agent-in-browser'
export const PROTOCOL_VERSION = '1.0.0'
