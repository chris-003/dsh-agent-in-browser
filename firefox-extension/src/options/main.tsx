import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import browser from 'webextension-polyfill'
import { DEFAULT_SERVER_URL, DEFAULT_TOKEN } from '../protocol/types'

function App() {
  const [serverUrl, setServerUrl] = useState(DEFAULT_SERVER_URL)
  const [token, setToken] = useState(DEFAULT_TOKEN)
  const [webuiUrl, setWebuiUrl] = useState('http://127.0.0.1:3080')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    browser.storage.local.get(['serverUrl', 'token', 'webuiUrl']).then((v) => {
      if (v.serverUrl) setServerUrl(v.serverUrl as string)
      if (v.token) setToken(v.token as string)
      if (v.webuiUrl) setWebuiUrl(v.webuiUrl as string)
    })
  }, [])

  const save = () => {
    browser.storage.local.set({ serverUrl, token, webuiUrl }).then(() => {
      setSaved(true)
      setTimeout(() => setSaved(false), 1500)
    })
  }

  return (
    <div>
      <h1>agent-in-browser 选项</h1>
      <label>DSH 服务端地址（WebSocket）</label>
      <input value={serverUrl} onChange={(e) => setServerUrl(e.target.value)} placeholder="ws://127.0.0.1:38745" />
      <p className="hint">插件以此地址连接 DeepSeek Harness 侧 @chris-003/agent-in-browser 的 WebSocket 服务端。需与 DSH 侧 cordis.patch.yml 的 port 对齐。</p>
      <label>令牌（token）</label>
      <input value={token} onChange={(e) => setToken(e.target.value)} placeholder="agent-in-browser" />
      <p className="hint">需与 DSH 侧 cordis.patch.yml 的 token 一致。</p>
      <label>DSH WebUI 地址（侧边栏内嵌）</label>
      <input value={webuiUrl} onChange={(e) => setWebuiUrl(e.target.value)} placeholder="http://127.0.0.1:3080" />
      <p className="hint">「在侧边栏中打开」时内嵌的 DSH WebUI 地址。</p>
      <button onClick={save}>保存</button>
      {saved && <span className="ok">已保存</span>}
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
