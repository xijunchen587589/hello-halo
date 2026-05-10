package com.halo.mobile;

import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.webkit.WebView;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Register custom plugins before super.onCreate()
        registerPlugin(ForegroundServicePlugin.class);
        super.onCreate(savedInstanceState);

        // Enable edge-to-edge display: let app content draw behind system bars
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);

        // Inject status bar height as CSS variable for safe area padding.
        // Capacitor's built-in SystemBars plugin only injects CSS variables
        // on Android 16+ (VANILLA_ICE_CREAM). On earlier versions (including
        // MIUI 14 / Android 13-14), we handle it here so CSS env(safe-area-inset-top)
        // fallback (which returns 0 on Android WebView) is replaced with real values.
        injectSafeAreaInsets();
    }

    private void injectSafeAreaInsets() {
        // Use a retrying handler since the WebView may not be ready immediately
        getWindow().getDecorView().post(new Runnable() {
            @Override
            public void run() {
                if (bridge == null || bridge.getWebView() == null) {
                    // WebView not ready yet — retry after a short delay
                    getWindow().getDecorView().postDelayed(this, 200);
                    return;
                }

                int statusBarHeightPx = getStatusBarHeight();
                if (statusBarHeightPx <= 0) {
                    // Fallback: 48px is a reasonable default for ~24dp @ 2x density
                    statusBarHeightPx = 48;
                }

                float density = getResources().getDisplayMetrics().density;
                int statusBarDp = Math.round(statusBarHeightPx / density);

                WebView webView = bridge.getWebView();
                String script = "try {" +
                        "document.documentElement.style.setProperty('--safe-area-inset-top', '" + statusBarDp + "px');" +
                        "} catch(e) { console.error('safe-area-inset-top injection failed:', e); }";
                webView.evaluateJavascript(script, null);
            }
        });
    }

    private int getStatusBarHeight() {
        // Method 1: Get from WindowInsets (most accurate, requires API 30+)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            android.view.WindowInsets insets = getWindow().getDecorView().getRootWindowInsets();
            if (insets != null) {
                int topInset = insets.getInsets(android.view.WindowInsets.Type.statusBars()).top;
                if (topInset > 0) return topInset;
            }
        }

        // Method 2: Get from Android resource system (works on all API levels)
        int resourceId = getResources().getIdentifier("status_bar_height", "dimen", "android");
        if (resourceId > 0) {
            return getResources().getDimensionPixelSize(resourceId);
        }

        // Method 3: Fallback - compute from display metrics (~24dp)
        float density = getResources().getDisplayMetrics().density;
        return Math.round(24 * density);
    }
}
