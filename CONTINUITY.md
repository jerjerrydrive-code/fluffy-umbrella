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
| Camera | `npm run test:camera` | The real scan path, via a fake webcam fed a real code |
| Offline | `npm run test:offline` | Service worker, app shell, working with the network gone |
| Motion audit | `npm run audit:motion` | Everything *between* states; geometry; contrast |
| CI | automatic on push | That all of the above were actually run |
| Screenshots | read the PNGs | What no assertion thought to check |

`npm test` runs every spec, including camera and offline; the individual scripts are for when
you want one of them on its own.

### Offline is a promise, and it fails silently
A service worker registers fine, "installs" fine, and you discover it cached nothing useful the
first time you open the app on a train. `sw.js` used to swallow every `cache.add` failure, so a
renamed vendor file would install a worker that could not serve the app offline and say nothing.
It now refuses to install if a **critical** asset is missing, leaving the previous worker in
place, and two tests read the repo rather than the browser: everything the shell lists must
exist, and everything under `vendor/` and `icons/` must be in the shell. Adding a vendored file
and forgetting `sw.js` is otherwise invisible until you are offline.

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

**Failing is not enough — it has to fail for the reason you think.** A batch test asserted "each
code is logged exactly once", which looked like a guard against double-logging and was not:
`recordHistory` de-duplicates per `(data, source)`, so a same-source duplicate is impossible by
construction and the count can never exceed one. Injecting a deliberate second identical log
left it green. The bug it was supposed to catch was the CROSS-source duplicate — one entry as
`scanned` and another as `created` — which only counting across all sources will see. When a
test guards a specific past bug, reintroduce that bug and watch it fail.

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

## The launcher's input is not the app's to assume

Three rounds of threshold tuning (bugs #2, #6, #7) each shipped and each came back as "still
broken on my phone". The reason took a measurement, not more reading:

**The browser decides what a touch was, and it does not ask.** Two hard numbers, both measured
in `tests/regression.spec.js`:

- A native scroll container claims the gesture at **16px** of drift: `pointercancel` fires and
  no `click` is ever dispatched.
- With the scroller disabled, `click` *still* does not arrive past **~15px** — Chrome's own tap
  slop, not configurable.

16 CSS px is 2.5mm. Any launcher that activates on `click` is broken in the hand and fine on a
desk, which is exactly why it survived so long: **every mouse-driven test passed.** Playwright's
`.click()` targets an element, not a coordinate, so it cannot see this class of bug at all.

Rules that follow:

1. **Touch behaviour is only proven by dispatched touch.** `Input.dispatchTouchEvent` over CDP,
   at coordinates. A passing `page.click()` says nothing about a phone.
2. **Never activate a launcher control from `click`.** Own the gesture: `touch-action: none`,
   one state machine, dispatch on pointerup.
3. **If you act on pointerup, swallow the click that follows** — for *every* gesture, not just
   taps. The screen has already changed; that click lands on whatever is there now. It cost two
   separate defects here: the viewer closing itself, and a long press opening Rename.
4. **A browser smooth scroll cannot be cancelled and it wins.** Animate snaps yourself, and route
   every page move through the one animation you can cancel.
5. **One threshold, one meaning.** Two thresholds (lock the axis at 12px, allow taps to 24px)
   created a dead band where a 16px touch became a 16px pan that snapped back — indistinguishable
   from the bug being fixed.

Three of the five defects in that revamp were in the *new* code and were caught by probing it
before release rather than by reading it. Write the probe.

## `npm test` and `npm run audit:motion` cannot run at the same time

Both bind **port 4173** — the audit spawns its own server (`scripts/motion-audit.mjs`), and
Playwright's `webServer` starts one for the suite. Run them concurrently and the audit dies with
a bind error that looks alarming and means nothing about the app. Run them one after the other.

Recorded because it was chased twice: an audit that "fails" immediately after a green suite is
almost always this.

## Moving work is not the same as removing it

`openEnlarge` cost 10.3ms, nearly all of it two whole-document `lucide.createIcons()` sweeps.
The first fix moved them into the opening `requestAnimationFrame` — and that was worse: the cost
landed inside the first frame of the transition, stalling the animation instead of delaying it.
The motion audit went from clean all day to a finding in **half** its runs, which is how it was
caught.

`lucide.createIcons()` walks every `[data-lucide]` in the document. Wanting five icons costs the
same as wanting two hundred. There is a cache (`iconSvg`) — use it, and **warm it at init**
alongside the others, or the first interaction that needs an icon pays the sweep the cache exists
to avoid. That warming step was missed when the cache was generalised and cost 35–42ms on the
first code opened, against a two-frame budget.

Result: 10.3ms to 0.4ms, no sweeps, no special case for the first open.

The general rule, which has now bitten twice here: when something is too slow, ask whether it can
stop happening before asking when it should happen.
