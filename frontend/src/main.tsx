import React from 'react'
import ReactDOM from 'react-dom/client'
import * as pdfjsLib from 'pdfjs-dist'
import App from './App'
import './index.css'

// Set once at app boot. Wrapped in try/catch because Firefox extensions proxy
// pdfjs module objects via XrayWrapper and throw on property writes.
try { pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.js' } catch (_) {}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
