import { StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

const elem = document.getElementById('root')!
const app = (
  <StrictMode>
    <App />
  </StrictMode>
)

if (import.meta.hot) {
  const data = import.meta.hot.data as { root?: Root }
  ;(data.root ??= createRoot(elem)).render(app)
} else {
  createRoot(elem).render(app)
}
