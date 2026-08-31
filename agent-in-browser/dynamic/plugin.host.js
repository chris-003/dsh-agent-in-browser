// Dynamic Cordis plugin HOST body (plain JS, for `cordis_define`) — the
// "for testing" form of @chris-003/agent-in-browser.
//
// Registers the browser_* tools, and tries to serve the WebSocket channel by
// spawning a standalone bridge server (`./bridge-server.mjs`) via the
// `subprocess` service. Dynamic host code cannot `import ws` / use `crypto`,
// so it cannot host the socket itself; the child process can.
//
// Put this function body into `cordis_define`'s `code.host`. Adjust BRIDGE to
// the location of `bridge-server.mjs` on your machine.
return {
  name: 'agent-in-browser',
  inject: [],
  apply(ctx) {
    const subprocess = ctx.get('subprocess')
    // Resolve bridge-server.mjs without hard-coding a local path. Set the
    // AIB_BRIDGE env var to the absolute path on your machine; the fallback
    // names the file relative to the current working directory (your DSH
    // process's cwd), which is right when the plugin runs from the repo root.
    // Dynamic host code can't `import`/`require`, so keep this to env + cwd.
    const BRIDGE = process.env.AIB_BRIDGE || 'agent-in-browser/dynamic/bridge-server.mjs'
    let handle = null
    let buffer = ''
    let seq = 0
    const pending = new Map()
    const finish = () => {
      handle = null
      for (const [, p] of pending) p.reject(new Error('agent-in-browser: bridge stopped'))
      pending.clear()
    }
    const start = async () => {
      if (subprocess === undefined) return
      try {
        const nodeBin = await subprocess.resolveExecutable('node')
        handle = subprocess.spawn({ argv: [nodeBin, BRIDGE], stdin: 'pipe', stdout: 'pipe', stderr: 'ignore' })
        handle.stdout.on('data', (chunk) => {
          buffer += chunk.toString()
          let idx
          while ((idx = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, idx)
            buffer = buffer.slice(idx + 1)
            try {
              const res = JSON.parse(line)
              const p = pending.get(res.id)
              if (!p) continue
              pending.delete(res.id)
              if (res.ok) p.resolve(res.data)
              else p.reject(new Error(res.error || 'agent-in-browser: command failed'))
            } catch {}
          }
        })
        handle.done.then(finish, finish)
      } catch (err) {
        console.error('agent-in-browser: bridge start failed', err)
        finish()
      }
    }
    const send = (action, args) => {
      if (!handle) return Promise.reject(new Error('agent-in-browser: browser bridge not started (is subprocess mounted and the bridge server runnable?)'))
      const id = 'c' + (++seq)
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject })
        handle.stdin.write(JSON.stringify({ id, action, params: args || {} }) + '\n')
      })
    }
    ctx.effect(() => { void start(); return () => { try { handle && handle.terminate() } catch {} } }, 'agent-in-browser.bridge')
    const OBJECT_RESULT = { type: 'object', additionalProperties: true }
    const reg = (name, action, description, parameters) => {
      harness.registerTool(ctx, harness.defineTool({
        name,
        description,
        parameters,
        output: { schema: OBJECT_RESULT, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v, null, 2) }] },
        execute: (args) => send(action, args),
      }))
    }
    reg('browser_get_page', 'get_page', "Get the user's currently active tab: URL, title, description, favicon, selected text.", {})
    reg('browser_read', 'read_page', 'Extract cleaned visible text of the current page.', { maxLength: { type: 'number' }, includeLinks: { type: 'boolean' }, includeImages: { type: 'boolean' } })
    reg('browser_extract', 'extract', 'Extract links/images/meta/forms from the page.', { what: { type: 'string', enum: ['links', 'images', 'meta', 'forms', 'all'], required: true } })
    reg('browser_find_element', 'find_element', 'Locate an element by selector/text/role/aria-label.', { selector: { type: 'string' }, text: { type: 'string' }, role: { type: 'string' }, ariaLabel: { type: 'string' } })
    reg('browser_list_tabs', 'list_tabs', 'List all tabs in the current window.', {})
    reg('browser_activate_tab', 'activate_tab', 'Bring a tab to the front.', { tabId: { type: 'number', required: true } })
    reg('browser_open_tab', 'open_tab', 'Open a new tab at a URL.', { url: { type: 'string', required: true }, active: { type: 'boolean' } })
    reg('browser_close_tab', 'close_tab', 'Close a tab by id.', { tabId: { type: 'number', required: true } })
    reg('browser_screenshot', 'screenshot', 'Capture a screenshot (visible/region/full).', { mode: { type: 'string', enum: ['visible', 'region', 'full'] }, format: { type: 'string', enum: ['png', 'jpeg'] }, regionSelector: { type: 'string' } })
    reg('browser_click', 'click', 'Click an element.', { selector: { type: 'string' }, text: { type: 'string' }, ariaLabel: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' } })
    reg('browser_type', 'type', 'Type text into an input.', { selector: { type: 'string' }, text: { type: 'string', required: true }, clear: { type: 'boolean' }, pressEnter: { type: 'boolean' } })
    reg('browser_scroll', 'scroll', 'Scroll the page.', { selector: { type: 'string' }, to: { type: 'string', enum: ['top', 'bottom'] }, by: { type: 'number' }, ratio: { type: 'number' } })
    reg('browser_navigate', 'navigate', 'Navigate or go back/forward/reload.', { where: { type: 'string', enum: ['current', 'new', 'back', 'forward', 'reload'] }, url: { type: 'string' } })
    reg('browser_press', 'press', 'Send key presses.', { keys: { type: 'string' }, selector: { type: 'string' } })
    reg('browser_select', 'select', 'Select a <select> or check a box.', { selector: { type: 'string', required: true }, value: { type: 'string' }, type: { type: 'string', enum: ['select', 'check'] } })
    reg('browser_wait', 'wait', 'Wait for a condition.', { condition: { type: 'string', enum: ['selector', 'text', 'url', 'network-idle', 'navigation', 'timeout'], required: true }, selector: { type: 'string' }, text: { type: 'string' }, url: { type: 'string' }, timeoutMs: { type: 'number' } })
    reg('browser_storage', 'storage_get', 'Read extension storage workspace.', { keys: { type: 'array', items: { type: 'string' } } })
    reg('browser_write_storage', 'storage_set', 'Write extension storage workspace.', { values: { type: 'object', additionalProperties: true, required: true } })
    reg('browser_copy', 'copy', 'Copy text to the clipboard.', { text: { type: 'string', required: true } })
  },
}
