import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'

function App() {
  const [url, setUrl] = useState('http://127.0.0.1:3080')
  const [src, setSrc] = useState('')

  useEffect(() => {
    chrome.storage.local.get(['webuiUrl', 'serverUrl']).then((v) => {
      const webui = (v.webuiUrl as string) || 'http://127.0.0.1:3080'
      setUrl(webui)
      setSrc(webui)
    })
  }, [])

  return (
    <>
      <div className="bar">
        <b>DSH</b>
        <span>会话</span>
        <a onClick={() => setSrc(url + (url.includes('?') ? '&' : '?') + '_=' + Date.now())} href="#reload">
          刷新
        </a>
      </div>
      {src ? <iframe src={src} title="DeepSeek Harness WebUI" /> : null}
    </>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
