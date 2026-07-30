import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import './styles/layout.css'
import './styles/utilities.css'
import { FeedbackProvider } from './components/FeedbackProvider'
import { QueryClientProvider } from '@tanstack/react-query'
import { appQueryClient } from './lib/queryClient'
import { createIdbPersister } from './lib/idb-persister'
import { dehydrate, hydrate } from '@tanstack/react-query'
import { NetworkStatusBar } from './components/NetworkStatusBar'

// ── IDB persistence: restore cache on mount ───────────────────────────────
const persister = createIdbPersister()

persister.restoreClient().then((dehydratedState) => {
  if (dehydratedState) {
    try {
      hydrate(appQueryClient, dehydratedState)
      console.log('[main] Query cache restored from IndexedDB')
    } catch {
      // Stale or incompatible cache – start fresh
    }
  }
})

// Persist cache on every update (throttled by TanStack Query internals)
appQueryClient.getQueryCache().subscribe(() => {
  const state = dehydrate(appQueryClient)
  persister.persistClient(state)
})

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <QueryClientProvider client={appQueryClient}>
      <FeedbackProvider>
        <App />
        <NetworkStatusBar />
      </FeedbackProvider>
    </QueryClientProvider>
  </React.StrictMode>
)

