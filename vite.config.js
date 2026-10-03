import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The app calls its backend at the relative path "/.netlify/functions".
// In production (deployed to Netlify) that resolves same-origin to the
// site's own serverless functions. In local dev there are no functions
// on localhost, so we proxy that path to the LIVE deployed backend.
// Override the target with VITE_BACKEND_TARGET if you deploy your own.
const BACKEND_TARGET =
  process.env.VITE_BACKEND_TARGET || 'https://fascinating-platypus-46f604.netlify.app'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/.netlify/functions': {
        target: BACKEND_TARGET,
        changeOrigin: true,
        secure: true,
      },
    },
  },
})