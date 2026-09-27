import { useEffect, useState } from 'react'

// Installing Quaderno+ as an app. Chrome, Edge and Android offer a real install prompt
// (captured here so our own button can show it); iPhone/iPad and Safari on the Mac install
// from their share/File menu, so for those we only explain where to tap.
let deferredPrompt = null
let installedNow = false
const listeners = new Set()
const emit = () => listeners.forEach((l) => l())

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; emit() })
  window.addEventListener('appinstalled', () => { deferredPrompt = null; installedNow = true; emit() })
}

export const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true

export function installPlatform() {
  const ua = navigator.userAgent
  const iOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  if (iOS) return 'ios'
  if (/Android/i.test(ua)) return 'android'
  const safari = /Safari/.test(ua) && !/Chrome|Chromium|Edg|OPR|Firefox/.test(ua)
  if (safari && /Macintosh/.test(ua)) return 'mac-safari'
  if (/Firefox/.test(ua)) return 'firefox'
  return 'desktop'
}

export function useInstall() {
  const [, force] = useState(0)
  useEffect(() => {
    const l = () => force((n) => n + 1)
    listeners.add(l)
    return () => { listeners.delete(l) }
  }, [])
  return {
    installed: installedNow || isStandalone(),
    canPrompt: !!deferredPrompt,
    platform: installPlatform(),
    async prompt() {
      if (!deferredPrompt) return false
      const e = deferredPrompt
      deferredPrompt = null
      e.prompt()
      const choice = await e.userChoice.catch(() => null)
      emit()
      return choice?.outcome === 'accepted'
    },
  }
}

export const INSTALL_HELP = {
  ios: 'In Safari, tap the Share button, then “Add to Home Screen”.',
  'mac-safari': 'In Safari, open the File menu and choose “Add to Dock”.',
  android: 'Open the browser menu (⋮) and choose “Install app” or “Add to Home screen”.',
  firefox: 'Firefox cannot install web apps. Open Quaderno+ in Chrome, Edge or Safari to install it.',
  desktop: 'Use the install icon at the right of the address bar, or the browser menu → “Install Quaderno+”.',
}
