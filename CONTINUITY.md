# CONTINUITY — read this first

This file exists because context gets lost. Sessions end, conversations get summarised, and the
same mistakes get made twice. Everything below was learned by getting it wrong at least once.

If you are picking this project up cold, read this file before touching anything.

---

## 1. What this project is

**XanCode OS** — a single-file, iOS-homescreen-style PWA for scanning, generating and organising
barcodes and QR codes. Live at `https://jerjerrydrive-code.github.io/fluffy-umbrella/`.

**Self-containment is the hard constraint**, stated by the owner: *"self contained is key. not
always easy but key to simplicity to host."* `index.html` plus `./vendor`, `./icons`,
`manifest.json` and `sw.js`. Every path relative. No build step needed to run it. CI enforces
this — see `.github/workflows/ci.yml`.

Firebase is the single exception: a dynamic `import()` inside a `try/catch`, optional by design,
and the app carries on local-only when it fails.

---

## 2. Traps that have cost real time

### The file is CRLF, and blank lines carry trailing whitespace
`index.html` uses CRLF throughout. A Python script that writes it back with `\n` produces a
5,000-line diff of pure noise. Always open with `io.open(P, 'r', newline='')` and write with
`newline=''`, and build match patterns that tolerate trailing whitespace on blank lines:

```python
pat = '[ \t]*\r?\n'.join(re.escape(l.rstrip()) for l in old.split('\n'))
```

Check with `file index.html` after every scripted edit. It must still say "CRLF line terminators".

### A regex edit can rewrite its own output
A replacement that inserts text matching its own pattern will run again over what it just wrote.
This happened: a vibrate-to-`haptic()` migration rewrote the helper's own body. **Read the result
back.** "12 replaced" is not evidence that the right 12 were replaced.

### GitHub Pages serves the DEFAULT branch, not the working branch
Pages is in *"Deploy from a branch"* mode on `claude/barcode-scanner-recovery-g6w069`. Work
happens on `claude/recover-github-code-aimrux`. **Pushing does not deploy.** It goes live only
after the PR is merged into the default branch.

`.github/workflows/pages.yml` is manual-only on purpose — in branch mode `deploy-pages` fails
outright, and having it run on push put a red X on every commit.

### Verifying a deploy needs a marker unique to THAT commit
Polling the live URL for a string that already existed reports success against the stale build.
This happened with `library-sort-btn, .library-src-btn`, which was in the base CSS all along.
Pick a string introduced by the commit being verified, then finish with:

```
cmp -s live.html index.html && echo "byte-identical"
```

### The browser here cannot reach github.io
`curl` works through the proxy; Playwright gets `ERR_CONNECTION_RESET`. So the live site cannot
be driven directly. The workaround that is actually sound: `curl` the deployed file, `cmp` it
against the local one, and run the suite against the local file — if the bytes are identical the
suite is testing exactly what is deployed. Say it that way rather than claiming the live site
was exercised.

### CDNs are blocked in this sandbox
Every CDN returns `ERR_CONNECTION_RESET`. This once meant Tailwind never loaded and the app
rendered as unstyled text — while the entire suite stayed green, because it asserted behaviour
and never looked at a pixel. That is why the vendored assets exist, and why screenshots matter.

---

## 3. Checks and balances

Four independent layers. They catch different things and none of them subsumes another.

| Layer | Command | Catches |
|---|---|---|
| Regression suite | `npm test` | Behaviour, end states, data integrity |
| Motion audit | `npm run audit:motion` | Everything *between* states; geometry; contrast |
| CI | automatic on push | That the two above were actually run |
| Screenshots | read the PNGs | What no assertion thought to check |

### The rule that matters most
**A test that has never failed has proven nothing.** Before claiming a fix, verify the new test
fails against the previous build:

```bash
git stash push -- index.html
npx playwright test -g "<the new test>"     # must FAIL
git stash pop
```

Stash `index.html` only. Stashing everything reverts the test too, and it then "passes" by not
existing.

### The audit is evidence, not a verdict
It has accused the app **four times** when the tool was what was wrong:

1. Reported the skin morph blanking the icons — it was stepping the animation clock while JS
   `setTimeout`s ran in real time during screenshots.
2. Reported every Soft-skin icon label at 1.67:1 — it read only `background-color` and walked
   straight past the wallpaper, which is a *gradient* on a body whose colour is plain black.
3. Reported 18.9px of drag drift — it was measuring frames captured *after* release, where the
   icon is supposed to leave the finger.
4. Reported edit mode as having unreachable overflow — that is the dock, deliberately translated
   away at `opacity: 0`.

**Always confirm a finding with a screenshot before changing the app.** Fix the checker when the
checker is wrong, and say so.

### Flaky tests are defects, not noise
The folder-dwell test failed about one run in five. Chasing it found a real interaction bug: the
reorder swap moved the target out from under the pointer and cancelled the merge. Whether you
got a folder depended on where your last movement landed. **Never retry a flake away.**

Two of my own tests were also unsound and were fixed rather than papered over — one sampled in
real time and failed only under parallel load, the other measured panels mid-transition where
`scale-90` makes a 40px control report 36.

---

## 4. Architectural rules that must not be broken

1. **Firebase is optional.** Dynamic import inside `try/catch`. The app must work fully offline
   and signed out.
2. **Detach Firestore listeners BEFORE `signOut()`**, then wipe local state before signing back
   in as guest.
3. **One render path for codes.** Everything goes through `window.renderCode()`. Four hardcoded
   call sites used to drift apart.
4. **Skins are CSS + one attribute.** `body[data-skin="..."]`, layered over one DOM. Never fork
   the app to add a look.
5. **The white plate behind a code is never tinted.** Not by a theme, not by a skin, not by a
   backdrop. A tinted plate cuts the contrast a 1D reader needs, and scannability is functional,
   not decorative. `checkScannability()` also treats *polarity* separately from contrast:
   inverted 1D codes fail outright at any ratio, including 21:1.
6. **Every dismissable layer registers with `XanNav`.** Otherwise the hardware Back button leaves
   the app instead of closing the layer. The registration list is the contract; a test asserts
   every layer is in it.
7. **Skins list the text they recolour by hand.** Anything added later keeps the default dark
   chrome's colours and can end up invisible — this is exactly how Soft's Library pills reached
   1.22:1. When adding a control, check it on all six skins, or better, drive it from an
   inheriting variable like `--accent-readable` so it needs no entry at all.

---

## 5. Only the owner can do these

Both are Firebase console settings. No code change reaches them, and the app now explains each
one in words instead of printing an error code.

- **Authorized domains.** `auth/unauthorized-domain` means `jerjerrydrive-code.github.io` is not
  listed under Authentication → Settings → Authorized domains. Google sign-in will not run on
  the live site until it is.
- **Anonymous sign-in returns HTTP 400.** Found by CI, which has real outbound network — this
  development machine has none and structurally cannot see it. Every page load POSTs to
  `identitytoolkit.googleapis.com/v1/accounts:signUp` and gets a 400. Two candidate causes and
  it is not worth guessing between them: the Anonymous provider is off under Authentication →
  Sign-in method, or the API key carries a referrer restriction the origin does not satisfy
  (Google Cloud console → Credentials). Either way the app no longer lets it take cloud sync
  down; Google sign-in is still offered and everything local is unaffected.

**The lesson worth keeping:** the difference between the two environments is a feature, not an
annoyance. Anything network-dependent is invisible here and visible in CI. Read CI's audit log.

---

## 6. Where things stand

Done and live: navigation stack (hardware Back), edit-mode drag fixes, theme coverage across all
chrome, palette browsing, per-skin contrast, sign-in error messages, motion audit with gesture
coverage, CI.

Not done: widgets (native-only, belongs with the Capacitor wrapper), Phase 5
(accessibility/i18n/performance), Phase 6 (Capacitor native wrapper). See `ROADMAP.md`.

Camera scanning **is** now exercised end to end. Chromium will play a file back as if it were a
webcam (`--use-file-for-fake-video-capture`), so `scripts/fake-camera.mjs` builds a Y4M from the
app's own bwip-js and `tests/camera*.spec.js` drives the real path: permission, getUserMedia,
video element, frame grabber, decode callback, result sheet, save. Two symbologies, QR and
Code 128, with different payloads — deliberately, so a vacuous assertion would show up as both
specs reporting the same thing.

Two things that bit while building it, both worth not rediscovering:

- **Do not `import` a `.mjs` helper from a spec.** Playwright transforms it to CommonJS while
  Node loads it as ESM and the two disagree — `exports is not defined in ES module scope`, before
  any test runs. Shell out with `execFileSync` instead.
- **`launchOptions` must be file-level.** Playwright rejects it inside a `describe`, which is why
  the 1D case is its own spec rather than a second block.
- **Do not assert on `video.videoWidth`.** It comes from stream metadata and can still read 0
  when the decode lands on an early frame, which it does here because the fake camera shows a
  large, clean code. Sample the media *track* instead: its settings exist as soon as the stream
  does, and a `live` track is what proves a real capture device was opened.

---

## 7. How to not get stuck

- **Measure before concluding.** Nearly every wrong turn here started with reasoning about what
  the code should do instead of running something and reading the answer.
- **When a fix does not work twice, the model of the problem is wrong.** Stop patching and go
  read the actual state — computed styles, real timings, a screenshot.
- **Finish the loop.** Commit, push, merge, then verify the live bytes. Work that stops at
  "pushed" is not delivered; Pages serves the default branch.
- **Report what was verified and how.** "Tests pass" and "I used it" are different claims. The
  owner has already been burned by the first being presented as the second.
