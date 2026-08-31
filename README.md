# dsh-agent-in-browser

> **[English](./README.md) | [中文](./README.zh.md)**

A Chrome extension plus a DeepSeek Harness (DSH) plugin. A DSH agent can read and
drive the browser you are using through `tool_call`s, and optionally embed the DSH
Web UI in a side panel.

## How it works

Manifest V3 extensions cannot listen on a TCP or WebSocket port
(`chrome.sockets.tcpServer` is a deprecated Chrome Apps API). The extension therefore
connects to a server on the DSH side as a WebSocket client. The channel is
bidirectional: the agent sends a command via `tool_call`, the extension runs it and
replies.

```
DSH agent ──tool_call──▶ @chris-003/agent-in-browser (Host: WS server @127.0.0.1:port)
   Host plugin ◀──── WebSocket (persistent, token handshake + heartbeat) ──── Chrome extension
                                                                          │
                                           ┌─────────────────────────────┴──────────────┐
                                           │ service-worker: tab/window-level actions    │
                                           │ content-script: page DOM interaction        │
                                           └──────────────────────────────────────────────┘
```

- **Frame protocol**: a request is `{type:'command', id, action, params}`, the reply
  is `{type:'result', id, ok, data|error}`. The handshake is
  `{type:'hello', token, version, actions}`, heartbeat is `ping/pong`. Constants live
  in `agent-in-browser/lib/protocol/types.js` and `chrome-extension/src/protocol/types.ts`;
  keep those two files in sync.

## Repository layout

```
.
├── agent-in-browser/        # DSH bundle package @chris-003/agent-in-browser
│   ├── package.json         # dsh.bundle.patch = ./cordis.patch.yml
│   ├── cordis.patch.yml     # mounts the agent-in-browser plugin row
│   ├── lib/
│   │   ├── index.js         # plugin entry { name, inject, apply }
│   │   ├── host/server.js   # WebSocket server (token handshake / req-resp / timeout)
│   │   ├── host/tools.js    # registers the browser_* tools (defineTool)
│   │   └── protocol/types.js# frame protocol & action constants (mirrored)
├── chrome-extension/        # Chrome extension (Vite + TS + React, MV3)
│   ├── public/manifest.json
│   ├── offscreen.html            # offscreen document (crop util, WS keep-alive)
│   ├── popup.html / options.html # popup / options pages
│   ├── sidepanel.html            # side panel (embeds the DSH Web UI)
│   ├── vite.config.ts / tsconfig.json / package.json
│   └── src/
│       ├── protocol/types.ts            # protocol mirror
│       ├── background/service-worker.ts # all action routing + tab/window-level processing
│       ├── offscreen/offscreen.ts       # region screenshot crop util
│       ├── popup/main.tsx               # connection status + side-panel + options entry
│       ├── options/main.tsx             # server URL / token / WebUI URL config
│       └── sidepanel/main.tsx           # embedded DSH Web UI iframe
└── README.md
```

## Build

Build the Chrome extension (Vite bundle → `chrome-extension/dist/`):

```bash
cd chrome-extension
npm install          # if EALLOWSCRIPTS, add esbuild to allowScripts / .npmrc allow-scripts
npm run build
```

The DSH-side plugin (`agent-in-browser/lib/*.js`) is plain ESM and needs no build.

## Load the extension

1. Open `chrome://extensions/`, turn on **Developer mode**.
2. **Load unpacked** → select `chrome-extension/dist`.
3. Confirm there are no errors. The extension connects to `ws://127.0.0.1:38745`
   (token `agent-in-browser`) by default, or to whatever you set on the options page.

## Configuration (keep both sides aligned)

- **DSH side**: `agent-in-browser/cordis.patch.yml` → `config.port` / `config.token`
  (default `38745` / `agent-in-browser`). You can also edit these from the DSH Web UI
  under **Settings → Plugins → Plugin Config**, and the change is saved to the user
  settings layer.
- **Extension side**: stored in `chrome.storage.local` (`serverUrl`, `token`, `webuiUrl`),
  editable on the options page.

## Mount the DSH plugin

The DSH side (`~/.dsh/profiles/web`) is a pnpm workspace. To make the plugin available
to DSH, add it to the profile's `dependencies` and `dsh.profile.bundles`, then install:

```bash
# in the web profile dir
pnpm add "@chris-003/agent-in-browser@link:/absolute/path/to/agent-in-browser"
```

Then confirm `@chris-003/agent-in-browser` is listed in the profile `package.json` under
`dsh.profile.bundles` (next to `@deepseek-ai/dsh-base` and `@deepseek-ai/dsh-web-app`),
run `pnpm install`, and **restart/reload the DSH Web UI**. The agent then sees the
`browser_*` tools and the WS server listens on `127.0.0.1:<port>`.

> **Local path deps**: pnpm installs a `link:` local dependency as a symlink, and
> `package-import-method=copy` does not produce a true independent copy for path deps
> (they stay hard-linked). To install a copy that is decoupled from your source tree,
> copy the package into the profile's `node_modules` instead, e.g.
> `cp -r agent-in-browser <profile>/node_modules/@chris-003/agent-in-browser`.

## Agent tools

`browser_get_page`, `browser_read`, `browser_extract`, `browser_find_element`,
`browser_list_tabs`, `browser_activate_tab`, `browser_open_tab`, `browser_close_tab`,
`browser_screenshot`, `browser_click`, `browser_type`, `browser_scroll`, `browser_navigate`,
`browser_press`, `browser_select`, `browser_wait`, `browser_storage`, `browser_copy`.

## Manifest permissions

- `tabs`, `activeTab`, `scripting`, `storage`, `offscreen`: tab reading, script injection,
  persistent WS (offscreen).
- `debugger`: full-page screenshot (`Page.captureScreenshot` + `captureBeyondViewport`).
- `clipboardWrite`: copy to clipboard.
- `host_permissions: <all_urls>`: inject scripts into any page. Chrome shows a broad
  permission prompt the first time you load the extension.

## License

[MIT](./LICENSE)
