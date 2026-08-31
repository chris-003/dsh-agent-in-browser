# dsh-agent-in-browser

> **[中文](./README.zh.md) | [English](./README.md)**

一个 Chrome 浏览器扩展 + DeepSeek Harness（DSH）配套插件。DSH 的 agent 可以通过
`tool_call` 读取并操控你正在使用的浏览器，并且可选地在浏览器侧边栏内嵌 DSH WebUI。

## 工作原理

Manifest V3 扩展**不能监听 TCP/WebSocket 端口**（`chrome.sockets.tcpServer` 是已废弃的
Chrome Apps API）。因此扩展作为 WebSocket 客户端，连接 DSH 侧托管的服务端。通道是
双向的：agent 通过 `tool_call` 下发命令，扩展执行后回传结果。

```
DSH agent ──tool_call──▶ @chris-003/agent-in-browser（Host：WS 服务端 @127.0.0.1:port）
   Host 插件 ◀──── WebSocket（持久双向，令牌握手 + 心跳）──── Chrome 扩展
                                                                  │
                                          ┌───────────────────────┴──────────────┐
                                          │ service-worker：标签页/窗口级动作     │
                                          │ content-script：页面 DOM 交互        │
                                          └───────────────────────────────────────┘
```

- **帧协议**：请求是 `{type:'command', id, action, params}`，响应是
  `{type:'result', id, ok, data|error}`。握手是 `{type:'hello', token, version, actions}`，
  心跳是 `ping/pong`。常量见 `agent-in-browser/lib/protocol/types.js` 与
  `chrome-extension/src/protocol/types.ts`，这两处需保持同步。

## 目录结构

```
.
├── agent-in-browser/        # DSH 配套 bundle 包 @chris-003/agent-in-browser
│   ├── package.json         # dsh.bundle.patch = ./cordis.patch.yml
│   ├── cordis.patch.yml     # 挂载 agent-in-browser 插件行
│   ├── lib/
│   │   ├── index.js         # 插件入口 { name, inject, apply }
│   │   ├── host/server.js   # WebSocket 服务端（令牌握手/请求-响应/超时）
│   │   ├── host/tools.js    # 注册 browser_* 新工具（defineTool）
│   │   └── protocol/types.js# 帧协议与动作常量（与扩展镜像）
├── chrome-extension/        # Chrome 扩展（Vite + TS + React，MV3）
│   ├── public/manifest.json
│   ├── offscreen.html            # offscreen 文档（裁剪工具，WS 保活）
│   ├── popup.html / options.html # 弹窗 / 选项页
│   ├── sidepanel.html            # 侧边栏（内嵌 DSH WebUI）
│   ├── vite.config.ts / tsconfig.json / package.json
│   └── src/
│       ├── protocol/types.ts            # 协议镜像
│       ├── background/service-worker.ts # 全部动作路由 + 标签页/窗口级处理
│       ├── offscreen/offscreen.ts       # 区域截图裁剪工具
│       ├── popup/main.tsx               # 连接状态 + 侧边栏 + 选项入口
│       ├── options/main.tsx             # 服务地址/令牌/WebUI 地址配置
│       └── sidepanel/main.tsx           # 内嵌 DSH WebUI 的 iframe
└── README.md
```

## 构建

构建 Chrome 扩展（Vite 打包到 `chrome-extension/dist/`）：

```bash
cd chrome-extension
npm install          # 若提示 EALLOWSCRIPTS，把 esbuild 加进 allowScripts / .npmrc 的 allow-scripts
npm run build
```

DSH 侧插件（`agent-in-browser/lib/*.js`）是纯 ESM，无需构建。

## 加载扩展

1. 打开 `chrome://extensions/`，开启右上角「开发者模式」。
2. 「加载已解压的扩展程序」→ 选择 `chrome-extension/dist`。
3. 确认扩展无报错。扩展默认连接 `ws://127.0.0.1:38745`（令牌 `agent-in-browser`），
   若你在选项页改过，则用那里的值。

## 配置（两侧需对齐）

- **DSH 侧**：`agent-in-browser/cordis.patch.yml` → `config.port` / `config.token`
  （默认 `38745` / `agent-in-browser`）。也可以在 DSH WebUI 的「设置 → 插件 → 插件配置」里修改，
  改动会保存到用户设置层。
- **扩展侧**：存在 `chrome.storage.local`（`serverUrl`、`token`、`webuiUrl`），可在选项页修改。

## 挂载 DSH 插件

DSH 侧（`~/.dsh/profiles/web`）是一个 pnpm workspace。要让插件对 DSH 可用，把它加进
profile 的 `dependencies` 与 `dsh.profile.bundles`，然后安装：

```bash
# 在 web profile 目录下
pnpm add "@chris-003/agent-in-browser@link:/绝对路径/to/agent-in-browser"
```

然后确认 `@chris-003/agent-in-browser` 已列在 profile `package.json` 的
`dsh.profile.bundles` 下（与 `@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-web-app` 并列），
运行 `pnpm install`，**重启/刷新 DSH WebUI**。之后 agent 会看到 `browser_*` 工具，
WS 服务端监听 `127.0.0.1:<port>`。

> **本地路径依赖**：pnpm 会把 `link:` 本地依赖安装为符号链接，而且
> `package-import-method=copy` 对路径依赖也不产生真正独立的副本（它们仍是硬链接）。
> 要安装一个与源码目录解耦的真副本，可以把包复制进 profile 的 `node_modules`，例如
> `cp -r agent-in-browser <profile>/node_modules/@chris-003/agent-in-browser`。

## agent 工具清单

`browser_get_page`、`browser_read`、`browser_extract`、`browser_find_element`、
`browser_list_tabs`、`browser_activate_tab`、`browser_open_tab`、`browser_close_tab`、
`browser_screenshot`、`browser_click`、`browser_type`、`browser_scroll`、`browser_navigate`、
`browser_press`、`browser_select`、`browser_wait`、`browser_storage`、`browser_copy`。

## Manifest 权限说明

- `tabs`、`activeTab`、`scripting`、`storage`、`offscreen`：标签页读取、脚本注入、
  持久 WS（offscreen）。
- `debugger`：整页截图（`Page.captureScreenshot` + `captureBeyondViewport`）。
- `clipboardWrite`：复制到剪贴板。
- `host_permissions: <all_urls>`：向任意页面注入脚本。首次加载扩展时，Chrome 会弹出较宽的权限提示。

## 许可证

[MIT](./LICENSE)
