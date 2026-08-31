// Registers the agent-facing browser tools. Each tool name maps to a wire
// action; `execute` sends the command over the WebSocket channel. The tool name
// is the agent-facing `browser_*` name; the wire action is the bare action the
// extension's service worker dispatches (get_page, list_tabs, screenshot, …).
import { Buffer } from 'node:buffer'
import { defineTool } from '@deepseek-ai/dsh-tools'

const OBJECT_RESULT = { type: 'object', additionalProperties: true }

function jsonText(value, truncate = 12000) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  return text.length > truncate ? `${text.slice(0, truncate)}\n…(truncated)` : text
}

// Register a screenshot tool that saves the captured image to the attachments
// service (so the model can see it directly) and renders it as an image block.
function registerScreenshotTool(server, ctx, spec) {
  ctx.tools.register(
    defineTool({
      name: spec.name,
      description: spec.description,
      parameters: spec.parameters,
      output: {
        schema: OBJECT_RESULT,
        render: (_args, value) => {
          if (value && value.attachment) {
            return [
              { type: 'text', text: `Screenshot captured: ${value.width ?? '?'}×${value.height ?? '?'} (${value.mime})` },
              { type: 'image', attachment: value.attachment },
            ]
          }
          return [{ type: 'text', text: jsonText(value) }]
        },
      },
      async execute(args) {
        const result = await server.send(spec.action, args)
        const att = ctx.get('attachments')
        if (att && result && typeof result.image === 'string' && result.image.length > 0) {
          const ref = await att.saveImage({
            data: Buffer.from(result.image, 'base64'),
            mediaType: result.mime || 'image/png',
          }).catch(() => null)
          if (ref) return { ...result, attachment: ref }
        }
        return result
      },
    }),
  )
}

function registerSendTool(server, ctx, spec) {
  ctx.tools.register(
    defineTool({
      name: spec.name,
      description: spec.description,
      parameters: spec.parameters,
      output: {
        schema: OBJECT_RESULT,
        render: (_args, value) => [{ type: 'text', text: spec.render ? spec.render(value) : jsonText(value) }],
      },
      async execute(args) {
        // `spec.action` is the exact wire action; default to the tool name.
        return server.send(spec.action ?? spec.name, args)
      },
    }),
  )
}

export function registerBrowserTools(ctx, server) {
  // A. page information ------------------------------------------------------
  registerSendTool(server, ctx, {
    name: 'browser_get_page',
    action: 'get_page',
    description:
      "Get information about the user's currently active tab: URL, title, meta description, favicon, and any selected text. Read-only; does not modify the page. Use this before deciding what to read or interact with.",
    parameters: {},
    render: (v) =>
      `URL: ${v.url}\nTitle: ${v.title}\nDescription: ${v.description || '(none)'}\nFavicon: ${v.faviconUrl || '(none)'}` +
      (v.selectedText ? `\nSelected text: ${v.selectedText}` : ''),
  })

  registerSendTool(server, ctx, {
    name: 'browser_read',
    action: 'read_page',
    description:
      'Extract the cleaned visible text of the current page so the agent can read it. Optionally include links/images. Returns text only.',
    parameters: {
      maxLength: { type: 'number', description: 'Max characters to return (default 8000).' },
      includeLinks: { type: 'boolean', description: 'Also list the links on the page.' },
      includeImages: { type: 'boolean', description: 'Also list visible images.' },
    },
  })

  registerSendTool(server, ctx, {
    name: 'browser_extract',
    action: 'extract',
    description: 'Extract structured data from the current page: links, images, meta/OpenGraph, or form fields.',
    parameters: {
      what: { type: 'string', enum: ['links', 'images', 'meta', 'forms', 'all'], required: true, description: 'What to extract.' },
    },
  })

  registerSendTool(server, ctx, {
    name: 'browser_find_element',
    action: 'find_element',
    description:
      'Locate an element on the current page by CSS selector, text, role, or aria-label and return its bounding box and attributes. Use the returned coordinates/selector for click/type targeting.',
    parameters: {
      selector: { type: 'string', description: 'CSS selector.' },
      text: { type: 'string', description: 'Visible text to match.' },
      role: { type: 'string', description: 'ARIA role to match.' },
      ariaLabel: { type: 'string', description: 'aria-label to match.' },
    },
  })

  // D. tabs / windows --------------------------------------------------------
  registerSendTool(server, ctx, {
    name: 'browser_list_tabs',
    action: 'list_tabs',
    description:
      'List all open tabs in the current window with title, URL, favicon, and active state. Use this to choose which tab to operate on (screenshots only capture the active tab).',
    parameters: {},
  })

  registerSendTool(server, ctx, {
    name: 'browser_activate_tab',
    action: 'activate_tab',
    description:
      'Bring a specific tab to the front so screenshot/interaction targets it. Required before capturing a non-active tab, since Chrome can only screenshot the active tab.',
    parameters: { tabId: { type: 'number', required: true, description: 'The tab id to activate.' } },
  })

  registerSendTool(server, ctx, {
    name: 'browser_open_tab',
    action: 'open_tab',
    description: 'Open a new tab at the given URL (optionally in the background).',
    parameters: {
      url: { type: 'string', required: true, description: 'URL to open.' },
      active: { type: 'boolean', description: 'Activate the new tab (default true).' },
    },
  })

  registerSendTool(server, ctx, {
    name: 'browser_close_tab',
    action: 'close_tab',
    description: 'Close a tab by id.',
    parameters: { tabId: { type: 'number', required: true, description: 'Tab id to close.' } },
  })

  // B. screenshots -----------------------------------------------------------
  registerScreenshotTool(server, ctx, {
    name: 'browser_screenshot',
    action: 'screenshot',
    description:
      'Capture a screenshot of the browser. Modes: visible (active tab visible area), region (a DOM element by selector), full (full page, needs debugger permission). Returns the image.',
    parameters: {
      mode: { type: 'string', enum: ['visible', 'region', 'full'], description: 'Capture mode (default visible).' },
      format: { type: 'string', enum: ['png', 'jpeg'], description: 'Image format (default png).' },
      quality: { type: 'number', description: 'JPEG quality 0-100.' },
      regionSelector: { type: 'string', description: 'CSS selector for the region to capture (mode=region).' },
    },
  })

  // C. interaction -----------------------------------------------------------
  registerSendTool(server, ctx, {
    name: 'browser_click',
    action: 'click',
    description: 'Click an element on the current page by selector, text, aria-label, or coordinates.',
    parameters: {
      selector: { type: 'string', description: 'CSS selector.' },
      text: { type: 'string', description: 'Visible text to click.' },
      ariaLabel: { type: 'string', description: 'aria-label to click.' },
      x: { type: 'number', description: 'X coordinate.' },
      y: { type: 'number', description: 'Y coordinate.' },
    },
  })

  registerSendTool(server, ctx, {
    name: 'browser_type',
    action: 'type',
    description: 'Type text into an input/textarea (optionally clearing first, or pressing Enter after).',
    parameters: {
      selector: { type: 'string', description: 'CSS selector of the input.' },
      text: { type: 'string', required: true, description: 'Text to type.' },
      clear: { type: 'boolean', description: 'Clear existing value first (default true).' },
      pressEnter: { type: 'boolean', description: 'Press Enter after typing (default false).' },
    },
  })

  registerSendTool(server, ctx, {
    name: 'browser_scroll',
    action: 'scroll',
    description: 'Scroll the page (or a scroll container) to a position.',
    parameters: {
      selector: { type: 'string', description: 'Specific scroll container selector.' },
      to: { type: 'string', enum: ['top', 'bottom'], description: 'Scroll to top/bottom.' },
      by: { type: 'number', description: 'Scroll by this many pixels.' },
      ratio: { type: 'number', description: 'Scroll to this fraction of scrollHeight (0-1).' },
    },
  })

  registerSendTool(server, ctx, {
    name: 'browser_navigate',
    action: 'navigate',
    description: 'Navigate the current tab, open a new tab, go back/forward, or reload.',
    parameters: {
      where: { type: 'string', enum: ['current', 'new', 'back', 'forward', 'reload'], description: 'What to do (default current).' },
      url: { type: 'string', description: 'URL (required when where=current/new).' },
    },
  })

  registerSendTool(server, ctx, {
    name: 'browser_press',
    action: 'press',
    description: 'Send one or more key presses (e.g. Enter, Tab, Escape, Ctrl+C) to the focused element or page.',
    parameters: {
      keys: { type: 'string', description: 'A key or a comma-separated list of keys.' },
      selector: { type: 'string', description: 'Element to focus before pressing.' },
    },
  })

  registerSendTool(server, ctx, {
    name: 'browser_select',
    action: 'select',
    description: 'Select a <select> option or check/uncheck a checkbox/radio.',
    parameters: {
      selector: { type: 'string', required: true, description: 'CSS selector of the control.' },
      value: { type: 'string', description: 'Option value (for select) — omit to just check.' },
      type: { type: 'string', enum: ['select', 'check'], description: 'Control type (default select).' },
    },
  })

  registerSendTool(server, ctx, {
    name: 'browser_wait',
    action: 'wait',
    description:
      'Wait for a condition: an element/selector, text to appear, URL to match, network-idle, or a navigation to complete. Critical for reliable automation.',
    parameters: {
      condition: { type: 'string', enum: ['selector', 'text', 'url', 'network-idle', 'navigation', 'timeout'], required: true, description: 'What to wait for.' },
      selector: { type: 'string', description: 'Selector (condition=selector).' },
      text: { type: 'string', description: 'Text (condition=text).' },
      url: { type: 'string', description: 'URL substring (condition=url).' },
      timeoutMs: { type: 'number', description: 'Max wait in ms (default 10000).' },
    },
  })

  // E. misc ------------------------------------------------------------------
  // browser_storage is a single tool that reads (no values) or writes (values)
  // the extension storage workspace; it sends the matching wire action.
  ctx.tools.register(
    defineTool({
      name: 'browser_storage',
      description: 'Read or write a small key/value workspace in the extension storage (agent memory about browser/state).',
      parameters: {
        keys: { type: 'array', items: { type: 'string' }, description: 'Keys to read (omit for all).' },
        values: { type: 'object', additionalProperties: true, description: 'Entries to write.' },
      },
      output: { schema: OBJECT_RESULT, render: (_a, v) => [{ type: 'text', text: jsonText(v) }] },
      execute(args) {
        const action = args && typeof args.values === 'object' && args.values !== null ? 'storage_set' : 'storage_get'
        return server.send(action, args)
      },
    }),
  )

  registerSendTool(server, ctx, {
    name: 'browser_copy',
    action: 'copy',
    description: 'Copy the given text to the system clipboard.',
    parameters: { text: { type: 'string', required: true, description: 'Text to copy.' } },
  })
}
