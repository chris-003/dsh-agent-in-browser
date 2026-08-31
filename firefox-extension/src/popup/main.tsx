import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import browser from 'webextension-polyfill'

type State = { connected?: boolean; status?: string; lastError?: string; serverUrl?: string; token?: string }

function App() {
  const [s, setS] = useState<State>({})

  useEffect(() => {
    const load = () =>
      browser.storage.local.get(['connected', 'status', 'lastError', 'serverUrl', 'token']).then((v) => setS(v as State))
    void load()
    browser.storage.onChanged.addListener(() => void load())
  }, [])

  const statusLabel = s.connected ? '已连接 DSH' : s.status === 'connecting' ? '连接中…' : '未连接'
  const dot = s.connected ? 'on' : s.status === 'connecting' ? 'conn' : 'off'

  const openSidePanel = async () => {
    // Firefox: a sidebar is a persistent panel declared in the manifest
    // (sidebar_action). Open it for the current window.
    try {
      await browser.sidebarAction.open()
    } catch {
      // Opening a sidebar requires a user gesture context; some Firefox
      // versions restrict it. Swallow and rely on the toolbar button.
    }
  }

  const reconnect = async () => {
    await browser.runtime.sendMessage({ kind: 'RECONNECT' })
    setTimeout(() => browser.storage.local.get(['connected', 'status', 'lastError', 'serverUrl']).then((v) => setS((s) => ({ ...s, ...(v as State) }))), 1000)
  }

  return (
    <div>
      <h1>agent-in-browser</h1>
      <div className="row">
        <span className={`dot ${dot}`} />
        <span>{statusLabel}</span>
        <span className="muted">{s.serverUrl ?? 'ws://127.0.0.1:38745'}</span>
      </div>
      {s.lastError ? <p className="muted" style={{ color: '#ef4444' }}>{s.lastError}</p> : null}
      <div className="row">
        <button onClick={() => browser.runtime.openOptionsPage()}>选项</button>
        <button onClick={openSidePanel}>在侧边栏中打开</button>
      </div>
      {!s.connected && (
        <div className="row">
          <button onClick={reconnect}>重新连接</button>
        </div>
      )}
      <p className="muted">在「选项」里配置 DSH 服务地址与令牌；在「在侧边栏中打开」可侧边栏内嵌 DSH WebUI。</p>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
