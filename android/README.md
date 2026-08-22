# XanCode OS — Android

The web app in a WebView, with every asset bundled. No network is used or needed at runtime.

## Build

Needs a JDK (17+) and the Android SDK with `platforms;android-34` and `build-tools;34.0.0`.

```sh
export ANDROID_HOME=/path/to/android-sdk
gradle -p android assembleDebug        # android/app/build/outputs/apk/debug/app-debug.apk
```

The debug APK is signed with the local debug keystore, which is fine for sideloading and
useless for distribution. A release build needs a keystore you own — generate it yourself and
keep it, because losing it means never being able to update the app on a device that has it:

```sh
keytool -genkeypair -v -keystore xancode.jks -keyalg RSA -keysize 4096 -validity 10000 -alias xancode
```

## Why a WebView and not a Trusted Web Activity

A TWA renders the live site in Chrome with no browser chrome, which would have been less code.
It needs `/.well-known/assetlinks.json` served from the **root** of the origin to prove the app
and the site belong to the same owner. The site is a project page under a path on
`jerjerrydrive-code.github.io`, and the root of that domain is a different repository. A TWA
also has nothing to show without a connection on first run.

Bundling means the app is whatever shipped in the APK: it opens with no network, on a plane,
in a shop with no signal — which is where you actually need a barcode.

## Why the app is served over https:// and not file://

`MainActivity` serves the bundled assets through `WebViewAssetLoader` on
`https://appassets.androidplatform.net/assets/`.

A `file://` page is not a secure context. Two things follow, and both are fatal here:

- `getUserMedia` is unavailable, so the scanner — half of what this app is for — cannot open the
  camera at all.
- `localStorage` behaviour on `file://` origins varies by Android version, and every saved code
  lives in `localStorage`.

The asset loader serves the same files over an origin the platform treats as secure, so both
work exactly as they do in a browser. **Nothing in `index.html` is Android-specific**, and there
is no second copy of it: `copyWebApp` stages the repo-root files into the build directory at
assemble time, so the app in the APK is the app in the repo, always.

## What was verified, and what was not

Verified by unpacking the built APK and serving its own `assets/` tree at the same `/assets/`
path the WebView uses — including a server that 404s directory paths, which is what
`AssetsPathHandler` does and what an ordinary static server does not:

- boots with zero page errors and zero failed requests
- all four vendored libraries load; the dock renders; all five skins are present
- `localStorage` reads and writes
- the service worker installs, activates, and a reload still works

That last one is worth a note: `sw.js` lists `'./'` in its app shell, which resolves to the
directory path and 404s in an APK. It caches each URL in its own `try`/`catch` rather than with
`cache.addAll`, so the install survives it. With `addAll` the service worker would have failed
to install on device and passed every local test.

**Not verified: this has never been run on a real device or emulator** — there is no Android
runtime in the environment it was built in. The camera permission flow, the hardware back
button, and the edge-to-edge window are written to the documented contracts and are unproven.
