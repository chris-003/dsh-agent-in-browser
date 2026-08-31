import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'

type State = { connected?: boolean; serverUrl?: string; token?: string }

function App() {
  const [s, setS] = useState<State>({})

  useEffect(() => {
    const load = () => chrome.storage.local.get(['connected', 'serverUrl', 'token']).then((v) => setS(v as State))
    void load()
    chrome.storage.onChanged.addListener(() => void load())
  }, [])

  const openSidePanel = async () => {
    await chrome.sidePanel.setOptions({ path: 'sidepanel.html', enabled: true })
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    await chrome.sidePanel.open(tab?.windowId ? { windowId: tab.windowId } : {})
  }

  return (
    <div>
      <h1>agent-in-browser</h1>
      <div className="row">
        <span className={`dot ${s.connected ? 'on' : 'off'}`} />
        <span>{s.connected ? '已连接 DSH' : '未连接'}</span>
        <span className="muted">{s.serverUrl ?? 'ws://127.0.0.1:38745'}</span>
      </div>
      <div className="row">
        <button onClick={() => chrome.runtime.openOptionsPage()}>选项</button>
        <button onClick={openSidePanel}>在侧边栏中打开</button>
      </div>
      <p className="muted">在「选项」里配置 DSH 服务地址与令牌；在「在侧边栏中打开」可侧边栏内嵌 DSH WebUI。</p>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
