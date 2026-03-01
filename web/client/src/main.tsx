import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { Dashboard } from './pages/Dashboard.tsx'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'

const isDashboard = window.location.hash === '#/dashboard'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      {isDashboard ? <Dashboard /> : <App />}
    </ErrorBoundary>
  </StrictMode>,
)

// Register service worker for PWA support
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // SW registration failed — app continues without offline support
    })
  })
}
