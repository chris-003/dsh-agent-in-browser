import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import browser from 'webextension-polyfill'

function App() {
  const [src, setSrc] = useState('')

  useEffect(() => {
    browser.storage.local.get(['webuiUrl']).then((v) => {
      setSrc((v.webuiUrl as string) || 'http://127.0.0.1:3080')
    })
  }, [])

  // Fill the whole side panel with the DSH WebUI. Retry loading the URL until
  // the user configures it, without any extension chrome over the iframe.
  return <>{src ? <iframe src={src} title="DeepSeek Harness WebUI" /> : null}</>
}

createRoot(document.getElementById('root')!).render(<App />)
