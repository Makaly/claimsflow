import React from 'react'
import ReactDOM from 'react-dom/client'
import * as pdfjsLib from 'pdfjs-dist'
import App from './App'
import './index.css'
import { installFetchProxy } from './lib/installFetchProxy'

// Wrap window.fetch before any component mounts. Rewrites the older raw
// fetch('/api/...') call sites that still live in some components onto the
// absolute backend URL and adds credentials so the HttpOnly auth cookie
// rides with them. Safe no-op when same-origin or when called twice.
installFetchProxy()

// Set once at app boot. Wrapped in try/catch because Firefox extensions proxy
// pdfjs module objects via XrayWrapper and throw on property writes.
try { pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.js' } catch (_) {}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
