# agent-in-browser

Chrome 浏览器插件 + DeepSeek Harness 配套插件，让 DSH 的 agent 能通过 `tool_call` 实时读取/操控用户正在浏览的网页，并可在浏览器侧边栏打开 DSH WebUI（规划中）。

> 当前进度：**M1 最小闭环**（`browser_get_page` 等 + 本地 WebSocket 通道）+ **M3 动作层**（截图 visible/region/full、点击/输入/滚动/按键/选择/等待、导航、标签页管理、storage、复制）已实现并可构建。M2（WebUI 配置卡片）、M3 UI（popup/options/sidepanel）、M4（文档完备）见路线图。

## 目录结构

```
mooc/
├── agent-in-browser/        # DSH 配套 bundle 包 @chris/agent-in-browser
│   ├── package.json         # 含 dsh.bundle.patch = ./cordis.patch.yml
│   ├── cordis.patch.yml     # 挂载 agent-in-browser 插件行
│   ├── lib/
│   │   ├── index.js         # 插件入口 { name, inject, apply }
│   │   ├── host/server.js   # WebSocket 服务端（令牌握手/请求-响应/超时）
│   │   ├── host/tools.js    # 注册 browser_* 新工具（defineTool）
│   │   └── protocol/types.js# 帧协议与动作常量（与扩展镜像）
│   └── test/server.smoke.mjs# 独立通道冒烟测试
├── chrome-extension/        # Chrome 扩展（Vite+TS+React，MV3）
│   ├── public/manifest.json
│   ├── vite.config.ts / tsconfig.json / package.json
│   └── src/
│       ├── protocol/types.ts    # 协议镜像
│       ├── background/service-worker.ts  # 命令路由 + 标签页/窗口级动作
│       ├── offscreen/offscreen.html|ts   # 持持久 WebSocket 连接
│       └── (popup/options/sidepanel/content 为 M3 预留)
├── scripts/dsh-mount.sh     # 由你运行：把 bundle 挂进 DSH web profile
└── README.md
```

## 架构

```
DSH agent ──tool_call──▶ @chris/agent-in-browser（Host：WS 服务端 @127.0.0.1:port）
   Host 插件 ◀──── WebSocket（持久双向，令牌握手+心跳）──── Chrome 扩展
                                                            │
                                    ┌───────────────────────┴──────────────┐
                                    │ service-worker：标签页/窗口级动作     │
                                    │ (M3) content-script：页面 DOM 交互   │
                                    └───────────────────────────────────────┘
```

- **为什么选这个方向**：Manifest V3 扩展**不能监听端口**（`chrome.sockets.tcpServer` 是已废弃的 Chrome Apps API），所以让扩展作为 WebSocket **客户端**主动连到 DSH 侧的服务端。连接建立后是双向的：agent 通过 `tool_call` 下发命令，扩展执行后回传。
- **帧协议**：请求 `{type:'command', id, action, params}` → 响应 `{type:'result', id, ok, data|error}`；握手 `{type:'hello', token, version, actions}`；心跳 `ping/pong`。常量见 `agent-in-browser/lib/protocol/types.js` 与 `chrome-extension/src/protocol/types.ts`（**两处需保持同步**）。

## 安装（由你执行）

依赖由你在自己的 shell 里安装。该环境用 `allow-scripts` 白名单（已含 `esbuild`），`package.json` 里已放 `allowScripts: ["esbuild"]`。

### 1. 构建 DSH 插件（宿主侧为纯 ESM，无需打包）

`@chris/agent-in-browser/lib/*.js` 就是可运行源码，直接使用，无需构建。若要跑冒烟测试（需 `ws`），在 `mooc` 下确保能解析 `ws`/`@deepseek-ai/dsh-tools`：

```bash
cd mooc
node agent-in-browser/test/server.smoke.mjs   # 预期输出 [test] PASS
```

### 2. 构建 Chrome 扩展

```bash
cd chrome-extension
npm install          # 若提示 EALLOWSCRIPTS，把 esbuild 加进 allowScripts / .npmrc 的 allow-scripts
npm run build        # 产物在 dist/
```

## 加载扩展

1. 打开 `chrome://extensions/`，开启右上角「开发者模式」。
2. 「加载已解压的扩展程序」→ 选择 `chrome-extension/dist`。
3. 确认扩展无报错；扩展会自动用默认配置连到 `ws://127.0.0.1:38745`（令牌 `agent-in-browser`）。

## 配置（两侧对齐）

- **DSH 侧**：`agent-in-browser/cordis.patch.yml` 里的 `config.port` / `config.token`（默认 `38745` / `agent-in-browser`）。
- **扩展侧**：默认 `ws://127.0.0.1:38745` + 令牌 `agent-in-browser`。扩展用 `chrome.storage.local` 存 `serverUrl` 与 `token`（M3 的 options 页可改；暂用默认值即可对齐）。

## 挂载 DSH 插件

在**你自己的 shell** 里运行（它写入 `~/.dsh`，agent 沙箱无权访问）：

```bash
cd mooc
bash scripts/dsh-mount.sh            # 挂载（幂等）
bash scripts/dsh-mount.sh --status   # 查看是否已挂载
```

脚本会把 `@chris/agent-in-browser` 加入 web profile 的 `dependencies`（`link:</abs/path>`）与 `dsh.profile.bundles`，然后在 profile 目录 `pnpm install`（无 pnpm 则退回 npm）。随后**重启/刷新 DSH Web UI**，插件生效：agent 工具列表出现 `browser_*` 工具，WS 服务端监听 `127.0.0.1:<port>`。

## 验证（M1）

1. 扩展已连上 DSH（端口默认 `38745`）。
2. 在 agent 会话调用 `browser_get_page` → 返回当前激活标签页的 URL / 标题 / 描述 / 选中文本。

## agent 工具清单

`browser_get_page`、`browser_read`、`browser_extract`、`browser_find_element`、`browser_list_tabs`、`browser_activate_tab`、`browser_open_tab`、`browser_close_tab`、`browser_screenshot`、`browser_click`、`browser_type`、`browser_scroll`、`browser_navigate`、`browser_press`、`browser_select`、`browser_wait`、`browser_storage`、`browser_copy`。

> 实现状态：`get_page`、`read_page`、`extract`、`find_element`、`list_tabs`、`activate_tab`、`open_tab`、`close_tab`、`screenshot`（visible/region/full）、`click`、`type`、`scroll`、`navigate`、`press`、`select`、`wait`、`storage_get/set`、`copy` 均已在扩展 SW / offscreen 实现。

## 权限说明（manifest）

- `tabs`、`activeTab`、`scripting`、`storage`、`offscreen`：标签页读取、脚本注入、持久 WS（offscreen）。
- `debugger`：整页截图（`Page.captureScreenshot` + `captureBeyondViewport`）。
- `clipboardWrite`：复制到剪贴板。
- `host_permissions: <all_urls>`：scripting 注入任意页面。会触发较宽的权限提示，加载时 Chrome 会告知。

## 路线图

- **M1 最小闭环** ✅：WS 服务端 + 工具注册 + 扩展 offscreen 连接 + `get_page`。
- **M2 WebUI 配置卡片**：Client 半注册 `settings.plugin.item` 卡片，可在「设置→插件」改端口/令牌；验证 bundle 挂载。
- **M3 扩展完整功能**：popup（连接状态 + 侧边栏入口 + 选项）、options（服务地址/令牌）、sidepanel（内嵌 DSH WebUI）；实现全部动作（页面 DOM 交互、截图）。
- **M4 集成与文档**：断线重连/心跳/超时、无连接可读报错、权限说明、发布说明。
