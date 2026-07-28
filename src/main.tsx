import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { initWebFallbackApi } from './webFallbackApi'
import './styles/app.css'

initWebFallbackApi()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)

