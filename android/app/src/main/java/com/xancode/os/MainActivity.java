package com.xancode.os;

import android.Manifest;
import android.content.ContentValues;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.widget.Toast;

import java.io.OutputStream;
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
    private static final String PREFS = "xancode";
    private static final String KEY_BG = "last_bg";
    /** The Cloud skin's ground — the skin a first run opens in. */
    private static final int DEFAULT_BG = 0xFFE9ECF4;

    private WebView web;
    private PermissionRequest pendingCameraRequest;
    private ValueCallback<Uri[]> pendingFileChooser;
    private androidx.activity.result.ActivityResultLauncher<Intent> filePicker;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // The app draws its own clock and its own bottom bar. A system status bar on top of that
        // is a second clock two centimetres from the first one, so the window goes edge to edge
        // and the web layer owns the whole screen — the same thing display:"standalone" asks for
        // in the web manifest.
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                             WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS);

        // THE COLD-START FLASH.
        //
        // The window is painted by the system before the WebView has drawn anything, and it was
        // painted #0a0a12 — a near-black taken from the web manifest's theme_color, written when
        // the app was a dark one. It opens in Cloud, which is near-white. So every cold start
        // was black, then white, and no test on a desktop browser can see that because the flash
        // is not in the page at all.
        //
        // The colour is remembered from the last run instead of hardcoded, so it stays right for
        // somebody who picks a dark skin rather than being right only for the default.
        SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        int bg = prefs.getInt(KEY_BG, DEFAULT_BG);
        getWindow().setBackgroundDrawable(new ColorDrawable(bg));

        // A WebView has no file picker of its own. Without onShowFileChooser below, every
        // <input type="file"> in the page is inert — tapping it does nothing at all, with no
        // error anywhere. That is one line of Android and six broken features: Import Backup,
        // Restore, Set Custom Wallpaper and Scan From Image were all dead in the first build.
        filePicker = registerForActivityResult(
                new androidx.activity.result.contract.ActivityResultContracts.StartActivityForResult(),
                result -> {
                    if (pendingFileChooser == null) return;
                    Uri[] uris = null;
                    Intent data = result.getData();
                    if (result.getResultCode() == RESULT_OK && data != null) {
                        if (data.getClipData() != null) {
                            int n = data.getClipData().getItemCount();
                            uris = new Uri[n];
                            for (int i = 0; i < n; i++) uris[i] = data.getClipData().getItemAt(i).getUri();
                        } else if (data.getData() != null) {
                            uris = new Uri[]{ data.getData() };
                        }
                    }
                    // null, not an empty array: an empty array tells the page a file was chosen
                    // and it was nothing, so a cancelled picker looks like a corrupt file.
                    pendingFileChooser.onReceiveValue(uris);
                    pendingFileChooser = null;
                });

        web = new WebView(this);
        // Without this the WebView itself is white underneath the page, which reintroduces the
        // same flash one layer down on a dark skin.
        web.setBackgroundColor(bg);
        setContentView(web);
        web.addJavascriptInterface(new SaveBridge(), "XanCodeAndroid");

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);          // every saved code lives in localStorage
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setTextZoom(100);
        // signInWithPopup asks the page to open a window. A WebView refuses by default and the
        // call fails with a generic error, which is what pushed the flow onto the redirect
        // fallback that was then being ejected to Chrome.
        s.setSupportMultipleWindows(true);
        s.setJavaScriptCanOpenWindowsAutomatically(true);                    // the layout is tuned in px; system font scaling
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
            public void onPageFinished(WebView view, String url) {
                // Ask the page what colour it actually is and keep it for the next cold start.
                // The ground is painted by body::before on most skins and by the body itself on
                // others, so both are tried before falling back.
                view.evaluateJavascript(
                    "(function(){function s(e,p){try{var c=getComputedStyle(e,p).backgroundColor;"
                  + "return (c&&c.indexOf('rgba(0, 0, 0, 0)')===-1&&c!=='transparent')?c:null;}"
                  + "catch(e){return null;}}"
                  + "return s(document.body,'::before')||s(document.body,null)"
                  + "||s(document.documentElement,null)||'';})()",
                    value -> rememberBackground(value));
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                // Anything that is not the bundled app is the outside world: a scanned URL, a
                // tel: link, a mailto:. Handing those to the WebView would strand the user in a
                // browser with no way back that looks like one.
                if (u.toString().startsWith(ORIGIN)) return false;
                // ...except the sign-in flow, which is not the outside world — it is this app
                // in the middle of doing something and needing to come back.
                //
                // Firebase falls back to signInWithRedirect, which navigates to
                // <project>.firebaseapp.com/__/auth/handler and then on to Google. Ejecting that
                // to Chrome ends the flow permanently: whatever happens over there, the redirect
                // returns into Chrome, and this WebView never learns that anybody signed in. It
                // looked like the app had thrown the user out to a browser and given up.
                if (isAuthUrl(u)) return false;
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
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                             FileChooserParams params) {
                if (pendingFileChooser != null) pendingFileChooser.onReceiveValue(null);
                pendingFileChooser = callback;
                try {
                    // createIntent() carries the accept="" types and the multiple flag straight
                    // from the input element, so image/* opens on images and the backup input
                    // opens on everything, without this side re-deriving either.
                    filePicker.launch(params.createIntent());
                    return true;
                } catch (Exception e) {
                    pendingFileChooser = null;
                    return false;
                }
            }

            @Override
            public boolean onCreateWindow(WebView view, boolean dialog, boolean gesture,
                                          android.os.Message resultMsg) {
                // A popup is given a real WebView rather than being dropped, so whatever it
                // navigates to can render — including Google's own explanation of why it will
                // not serve OAuth to an embedded browser, which is far more use to somebody
                // than a button that appears to do nothing.
                WebView popup = new WebView(MainActivity.this);
                popup.getSettings().setJavaScriptEnabled(true);
                popup.getSettings().setDomStorageEnabled(true);
                popup.setWebViewClient(new WebViewClient());
                android.webkit.WebView.WebViewTransport t =
                        (android.webkit.WebView.WebViewTransport) resultMsg.obj;
                t.setWebView(popup);
                resultMsg.sendToTarget();
                return true;
            }

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

        // Downloads, which a WebView also does not do on its own.
        //
        // Everything this app saves — the JSON backup, the CSV, a code as a PNG — is built in
        // the page as a Blob and handed to an <a download>. In a browser that saves a file; in
        // a WebView nothing happens unless a DownloadListener is set, and even then a blob:
        // URL is unreadable from the Android side because the blob lives in the renderer.
        //
        // So the blob is read back where it exists — in JS — and passed over as base64. This
        // is deliberately done from here rather than by adding an Android branch to index.html:
        // the web build stays exactly as it is, and the page keeps using <a download>.
        web.setDownloadListener((url, userAgent, disposition, mimeType, size) -> {
            String name = guessName(url, disposition, mimeType);
            if (url.startsWith("blob:")) {
                web.evaluateJavascript(blobReaderJs(url, name, mimeType), null);
            } else if (url.startsWith("data:")) {
                int comma = url.indexOf(',');
                if (comma > 0) saveBase64(url.substring(comma + 1), name, mimeType);
            } else {
                try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); }
                catch (Exception ignored) { }
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

    /**
     * Hosts that are part of signing in rather than somewhere else to go.
     *
     * NOTE, because it matters and is not fixable from this side: Google refuses OAuth from an
     * embedded WebView (disallowed_useragent), so keeping these here makes the flow legible and
     * recoverable, not working. Completing sign-in in an app like this needs a native token —
     * Credential Manager with the project's Web OAuth client id, and this app's signing SHA-1
     * registered against the Firebase project. Both live in the owner's console, so neither can
     * be committed here.
     */
    private static boolean isAuthUrl(Uri u) {
        String host = u.getHost();
        if (host == null) return false;
        return host.endsWith("firebaseapp.com")
            || host.endsWith("accounts.google.com")
            || host.endsWith("googleapis.com")
            || host.endsWith("gstatic.com");
    }

    /** Stores the page's own background colour for the next launch's window background. */
    private void rememberBackground(String jsValue) {
        if (jsValue == null) return;
        String v = jsValue.replace("\"", "").trim();
        if (v.isEmpty()) return;
        java.util.regex.Matcher m = java.util.regex.Pattern
                .compile("(\\d+(?:\\.\\d+)?)").matcher(v);
        int[] c = new int[3];
        for (int i = 0; i < 3; i++) {
            if (!m.find()) return;
            c[i] = Math.max(0, Math.min(255, Math.round(Float.parseFloat(m.group(1)))));
        }
        int colour = Color.rgb(c[0], c[1], c[2]);
        SharedPreferences p = getSharedPreferences(PREFS, MODE_PRIVATE);
        if (p.getInt(KEY_BG, 0) == colour) return;
        p.edit().putInt(KEY_BG, colour).apply();
    }

    /** Reads a blob: URL back inside the page and hands it over as base64. */
    private static String blobReaderJs(String blobUrl, String name, String mime) {
        return "(function(){var x=new XMLHttpRequest();x.open('GET','" + blobUrl + "');"
             + "x.responseType='blob';x.onload=function(){var r=new FileReader();"
             + "r.onloadend=function(){var s=r.result;var i=s.indexOf(',');"
             + "XanCodeAndroid.save(s.substring(i+1)," + jsStr(name) + "," + jsStr(mime) + ");};"
             + "r.readAsDataURL(x.response);};x.send();})()";
    }

    private static String jsStr(String s) {
        return "\"" + (s == null ? "" : s.replace("\\", "\\\\").replace("\"", "\\\"")) + "\"";
    }

    private static String guessName(String url, String disposition, String mime) {
        try {
            String n = android.webkit.URLUtil.guessFileName(url, disposition, mime);
            if (n != null && !n.isEmpty()) return n;
        } catch (Exception ignored) { }
        return "xancode-" + System.currentTimeMillis();
    }

    public class SaveBridge {
        @JavascriptInterface
        public void save(String base64, String name, String mime) {
            runOnUiThread(() -> saveBase64(base64, name, mime));
        }
    }

    /**
     * Writes to the shared Downloads collection, so the file is where a person looks for it
     * rather than inside the app's private storage where nothing else can open it.
     */
    private void saveBase64(String base64, String name, String mime) {
        try {
            byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
            Uri target;
            OutputStream out;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentValues v = new ContentValues();
                v.put(MediaStore.Downloads.DISPLAY_NAME, name);
                if (mime != null && !mime.isEmpty()) v.put(MediaStore.Downloads.MIME_TYPE, mime);
                v.put(MediaStore.Downloads.IS_PENDING, 1);
                target = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                if (target == null) throw new IllegalStateException("no download uri");
                out = getContentResolver().openOutputStream(target);
            } else {
                java.io.File dir = Environment.getExternalStoragePublicDirectory(
                        Environment.DIRECTORY_DOWNLOADS);
                if (!dir.exists()) dir.mkdirs();
                java.io.File f = new java.io.File(dir, name);
                out = new java.io.FileOutputStream(f);
                target = null;
            }
            if (out == null) throw new IllegalStateException("no stream");
            out.write(bytes);
            out.close();
            if (target != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentValues done = new ContentValues();
                done.put(MediaStore.Downloads.IS_PENDING, 0);
                getContentResolver().update(target, done, null, null);
            }
            Toast.makeText(this, "Saved to Downloads: " + name, Toast.LENGTH_LONG).show();
        } catch (Exception e) {
            Toast.makeText(this, "Could not save " + name, Toast.LENGTH_LONG).show();
        }
    }
}
