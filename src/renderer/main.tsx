/**		      	    				  	  	  	 		 		       	 	 	         	 	    					 
 * Halo - React Entry Point
 */

// ========================================
// LOGGING INITIALIZATION (must be first)
// ========================================
// Initialize electron-log only in Electron environment.
// In remote browser and Capacitor modes, native console is used since there's no IPC transport.
// Uses the same detection pattern as src/renderer/api/transport.ts:isElectron()
// Non-blocking: don't use top-level await to avoid blocking module graph in Vite dev mode
if (typeof window !== 'undefined' && 'halo' in window) {
  import('electron-log/renderer.js').then(({ default: log }) => {
    Object.assign(console, log.functions)
  })
}

import ReactDOM from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'


// ========================================
// CAPACITOR INITIALIZATION (mobile only)
// ========================================
// Initialize status bar for edge-to-edge display on Android.
// Runs eagerly to prevent status bar overlap before React mounts.
void (async () => {
  try {
    const Capacitor = (await import('@capacitor/core')).Capacitor;
    if (Capacitor.isNativePlatform()) {
      const { StatusBar } = await import('@capacitor/status-bar');
      await StatusBar.setOverlaysWebView({ overlay: true });
      await StatusBar.setStyle({ style: 'DARK' });

      // Fallback: ensure safe-area-inset-top CSS variable is set.
      // Capacitor's SystemBars plugin only injects it on Android 16+.
      // On older Android (MIUI 14 = Android 13-14), it's never set.
      // The native MainActivity.java also injects it, but this JS
      // fallback ensures it's set if native injection races or fails.
      await ensureSafeAreaTop();
    }
  } catch {
    // Non-Capacitor environments: silently ignore
  }
})();

/** Ensure --safe-area-inset-top CSS variable reflects the real status bar height.
 *
 *  Primary source: window.visualViewport.offsetTop — this gives the actual
 *  CSS-pixel offset from the screen top to the visual viewport, which matches
 *  the status bar height on mobile. This avoids the common off-by-a-few-px
 *  issues from Android resource-based status bar height calculations.
 *
 *  Native android injection (MainActivity.java) is the fallback — we prefer
 *  the JS-measured value because it's exact for the device's actual UI chrome.
 */
async function ensureSafeAreaTop(): Promise<void> {
  const setTop = (px: number) => {
    if (px > 0) {
      document.documentElement.style.setProperty('--safe-area-inset-top', px + 'px');
    }
  };

  // Helper: read the current CSS variable value
  const readCurrent = (): string =>
    getComputedStyle(document.documentElement)
      .getPropertyValue('--safe-area-inset-top').trim();

  // 1) Wait a moment for the native injection to happen first (more accurate)
  for (let i = 0; i < 5; i++) {
    const v = readCurrent();
    if (v && v !== '0px' && v !== '') return;
    await new Promise(r => setTimeout(r, 200));
  }

  // 2) Use visualViewport.offsetTop as the primary measurement (real-time, exact)
  const updateFromViewport = () => {
    if (window.visualViewport && window.visualViewport.offsetTop > 0) {
      setTop(window.visualViewport.offsetTop);
      return true;
    }
    return false;
  };

  if (updateFromViewport()) return;

  // 3) Last resort: the native injection may still arrive late,
  //    or read from what the native code already set.
  for (let i = 0; i < 5; i++) {
    await new Promise(r => setTimeout(r, 300));
    if (updateFromViewport()) return;

    const v = readCurrent();
    if (v && v !== '0px' && v !== '') return;
  }

  // 4) Ultimate fallback: ~24dp estimated from device pixel ratio
  const dpr = window.devicePixelRatio || 2;
  setTop(Math.round(24 * dpr));
}

// Keep safe-area-inset-top in sync when viewport changes (keyboard, rotation, etc.)
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', () => {
    if (window.visualViewport.offsetTop > 0) {
      document.documentElement.style.setProperty(
        '--safe-area-inset-top',
        window.visualViewport.offsetTop + 'px'
      );
    }
  });
}

// i18n configuration - must be imported before App
import './i18n'

// CSS imports - order matters for cascade
import './assets/styles/globals.css'       // Theme, base styles, shared animations
import './assets/styles/syntax-theme.css'  // Code syntax highlighting (highlight.js)
import './assets/styles/canvas-tabs.css'   // VS Code style tab bar
import './assets/styles/browser-task-card.css' // AI Browser sci-fi effects

// Mark React as mounted - disables global error fallback (React handles errors now)
// This flag is checked by the global error handler in index.html
;(window as unknown as { __HALO_APP_MOUNTED__: boolean }).__HALO_APP_MOUNTED__ = true
// __HALO_EGG__
;(() => { const c = [72,101,108,108,111,44,32,73,39,109,32,72,97,108,111,46,32,67,111,110,103,114,97,116,115,44,32,121,111,117,39,118,101,32,102,111,117,110,100,32,116,104,101,32,101,97,115,116,101,114,32,101,103,103,33]; console.log('%c' + String.fromCharCode(...c), 'color:#666;font-style:italic'); })()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
)
