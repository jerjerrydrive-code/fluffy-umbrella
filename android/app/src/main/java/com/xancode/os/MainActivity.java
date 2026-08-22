package com.xancode.os;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.ContextCompat;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.ServiceWorkerClientCompat;
import androidx.webkit.ServiceWorkerControllerCompat;
import androidx.webkit.WebViewFeature;

/**
 * XanCode OS in a WebView.
 *
 * The one decision everything else follows from: the app is served over
 * https://appassets.androidplatform.net/ by WebViewAssetLoader, NOT from file://.
 *
 * A file:// page is not a secure context. getUserMedia is unavailable there, so the scanner —
 * the reason half this app exists — simply would not work, and localStorage on file:// origins
 * is inconsistent across Android versions, which is where every saved code lives. The asset
 * loader serves the same bundled files over an origin the platform treats as secure, so both
 * work exactly as they do on the web build. Nothing about index.html changes for Android.
 */
public class MainActivity extends AppCompatActivity {

    private static final String ORIGIN = "https://appassets.androidplatform.net";
    private static final int REQ_CAMERA = 1001;

    private WebView web;
    private PermissionRequest pendingCameraRequest;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // The app draws its own clock and its own bottom bar. A system status bar on top of that
        // is a second clock two centimetres from the first one, so the window goes edge to edge
        // and the web layer owns the whole screen — the same thing display:"standalone" asks for
        // in the web manifest.
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                             WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS);

        web = new WebView(this);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);          // every saved code lives in localStorage
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setTextZoom(100);                    // the layout is tuned in px; system font scaling
                                               // would reflow the grid rather than help anyone

        final WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
                .setDomain("appassets.androidplatform.net")
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
                return loader.shouldInterceptRequest(req.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                // Anything that is not the bundled app is the outside world: a scanned URL, a
                // tel: link, a mailto:. Handing those to the WebView would strand the user in a
                // browser with no way back that looks like one.
                if (u.toString().startsWith(ORIGIN)) return false;
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, u));
                } catch (Exception ignored) { }
                return true;
            }
        });

        // The service worker fetches on its own thread through its own client. Without this it
        // would try to reach the real network for every same-origin asset, fail, and the app
        // would come up empty the first time the SW took control.
        if (WebViewFeature.isFeatureSupported(WebViewFeature.SERVICE_WORKER_BASIC_USAGE)) {
            ServiceWorkerControllerCompat.getInstance().setServiceWorkerClient(
                new ServiceWorkerClientCompat() {
                    @Override
                    public WebResourceResponse shouldInterceptRequest(WebResourceRequest req) {
                        return loader.shouldInterceptRequest(req.getUrl());
                    }
                });
        }

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(() -> {
                    boolean wantsCamera = false;
                    for (String r : request.getResources()) {
                        if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r)) wantsCamera = true;
                    }
                    if (!wantsCamera) { request.deny(); return; }

                    if (ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.CAMERA)
                            == PackageManager.PERMISSION_GRANTED) {
                        request.grant(new String[]{ PermissionRequest.RESOURCE_VIDEO_CAPTURE });
                    } else {
                        // Two separate permissions, and both have to be answered: Android's, then
                        // the WebView's. Granting the page before the OS has said yes gets a
                        // getUserMedia that fails with no explanation anywhere.
                        pendingCameraRequest = request;
                        requestPermissions(new String[]{ Manifest.permission.CAMERA }, REQ_CAMERA);
                    }
                });
            }
        });

        // The web app already drives history.pushState/popstate to model its own layers — the
        // viewer, the Library, Settings, the scanner. So the hardware back button does not need
        // to know anything about them: handing it to the WebView lets the app's own popstate
        // handler close whatever is on top, exactly as the browser back gesture does.
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (web.canGoBack()) web.goBack();
                else finish();
            }
        });

        if (savedInstanceState != null) web.restoreState(savedInstanceState);
        else web.loadUrl(ORIGIN + "/assets/index.html");
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] results) {
        super.onRequestPermissionsResult(code, perms, results);
        if (code != REQ_CAMERA || pendingCameraRequest == null) return;
        boolean ok = results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED;
        if (ok) pendingCameraRequest.grant(new String[]{ PermissionRequest.RESOURCE_VIDEO_CAPTURE });
        else pendingCameraRequest.deny();
        pendingCameraRequest = null;
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }
}
