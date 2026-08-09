# Bug tracker

Every defect found in XanCode OS, what caused it, and how it is now prevented from returning.

**Status legend** — `FIXED` shipped and guarded by a test · `OPEN` not yet fixed ·
`OWNER` needs a change only the account holder can make · `WONTFIX` deliberate, with reasons.

A bug is only marked FIXED when a test exists that was **verified to fail against the previous
build**. See `CONTINUITY.md` for why that rule exists, and for the two occasions a test looked
like a guard and was not.

---

## Reported from a phone

| # | Report | Cause | Status |
|---|---|---|---|
| 1 | "I get stuck in a lot of pages and cant go back" | No history integration at all — zero `pushState`, zero `popstate`. Android's Back left the PWA instead of closing the top layer. Applied to all 10 overlays at once. | FIXED — `XanNav` |
| 2 | "in edit mode i have to re tap on the icons to move their position again" | Releasing an icon over a free slot synthesised a click on that slot, which the background-tap handler read as "done rearranging" and ended edit mode. | FIXED |
| 3 | "im missing so many themes" | 338 palettes in one horizontal strip ≈ 15,000px of sideways scrolling. Also, tapping a swatch picked one of its four colours **at random**. | FIXED — wrapped grid, band-precise tapping |
| 4 | "so much doesn't even get themes" | The accent set two CSS variables. Every panel, sheet, backdrop, divider and the dock were hardcoded greys. | FIXED — chrome derives from the accent |
| 5 | "its missing the polish" | Skin morph left the whole screen illegible for 608ms of an 880ms sequence. | FIXED — ~420ms |
| 6 | "tap and hold for edit only works when tapping very certain spots" | The long press cancelled on **any** `touchmove`, with no tolerance. A finger always drifts over 600ms, so it depended on holding perfectly still. | FIXED — pointer events + 12px slop |
| 7 | "switching to page 2 in edit changes the icon from page one then shows in 2" | On a full page every swipe starts on an icon. A drag engaged after 5px in any direction, so the swipe grabbed the icon — and nothing constrained it, so it was dragged clean off the screen. | FIXED — swipe/drag split, and held icons are clamped on screen |
| 8 | `Sign-in error: Error (auth/unauthorized-domain)` | A raw Firebase code shown as a user-facing message. | FIXED (message) / OWNER (setting) |

---

## Found by the motion audit

`npm run audit:motion` — steps every animation frame by frame and sweeps 6 skins × 3 screen sizes.

| # | Defect | Status |
|---|---|---|
| 9 | Five controls under the 44px minimum, in layers the accessibility test never opened: the editor's close button (36²) and mode tabs (40 tall), the viewer's "+ Tag" (29), the search field and its Cancel (26) | FIXED |
| 10 | Soft skin: the Library's Saved/Scanned/Created row at **1.22:1** — white on pale, invisible rather than faint. `.library-src-btn` was added after the skin was written and never listed in its override. | FIXED |
| 11 | Aurora skin: the code viewer's title at **1.11:1** on near-black. The skin turned the surface dark and nothing recoloured the text. | FIXED |
| 12 | Arming a folder merge was **invisible** — the accent ring was drawn underneath the icon you were holding, so the only signal was the haptic, which is a setting the user can switch off | FIXED |

---

## Found by chasing a flaky test

| # | Defect | Status |
|---|---|---|
| 13 | Folder creation was unreliable: the reorder swap moved the target out from under the pointer on the same event that started the dwell, cancelling the merge. Whether you got a folder came down to where your last movement landed. Surfaced as a test failing ~1 run in 5. | FIXED |

**Never retry a flake away.** This one hid a real bug for as long as it was tolerated.

---

## Found by CI (which has network; the dev machine does not)

| # | Defect | Status |
|---|---|---|
| 14 | Anonymous sign-in returns **HTTP 400** on every page load, and the failure was unguarded in the init block — so it marked *all* cloud sync unavailable and the Account sheet then refused Google sign-in with "offline or blocked", which was wrong and unactionable | FIXED (contained) / OWNER (cause) |

---

## Found by reading the code for dead ends

| # | Defect | Status |
|---|---|---|
| 15 | The **WiFi dock button was dead** — it fell through to `showToast("WiFi coming soon.")`, the same shape as the Library button fixed earlier | FIXED — opens the WiFi form directly |
| 16 | Dock badges were **decoration**: a `'2'` on WiFi and a `'!'` on Scan, hardcoded in the default state, counting nothing and never changing — they told you a notification was waiting when none was | FIXED — the Library badge is now derived from the real saved count; the others are gone |
| 17 | The service worker swallowed every `cache.add` failure, so a renamed vendor file installed a worker that could not serve the app offline and said nothing | FIXED — refuses to install if a critical asset is missing |

---

## Found by measuring blocking cost under a realistic library

Every one of these was fine with the three codes the app ships with and bad at forty. A user
action that costs more than one frame (16.7ms) makes whatever it triggers stutter.

| # | Defect | Before | After | Status |
|---|---|---|---|---|
| 18 | Opening the Library rendered a barcode for **every** row as the list was built — and linear, so the more you used the app the worse it got | 452.6ms | 6.5ms | FIXED — thumbnails draw when they scroll into view |
| 19 | `showToast` called lucide's whole-document sweep, re-rendering all 59 icons on the page, to draw one icon in a toast — costing the toast its own first frame | 40.6ms | 0.2ms | FIXED — the two toast icons are rendered once and reused |
| 20 | Opening a code encoded at scale 5 **before** the layer became visible, so the opening animation started late | 38.3ms | ~0ms | FIXED — shows first, draws on the next frame |

The forced reflow that first fixed #19 was itself a bug: it cost 19ms of full-document layout on
a page with sixty icons, trading one frame drop for another. The toast is now animated explicitly
through the Web Animations API, which needs no "from" value inferred and so needs no reflow.

---

## Found by reading every swallowed error

| # | Defect | Status |
|---|---|---|
| 21 | The scanner's **Copy button lied**. `document.execCommand('copy')` returns `false` on failure *without throwing*, and the success toast fired unconditionally — so a copy that did nothing still said "Copied to clipboard". | FIXED |
| 22 | The viewer's Copy had **no `.catch()`** on `navigator.clipboard.writeText`, so a rejected write (no permission, document not focused) produced no message at all and an unhandled rejection. | FIXED |

Both are now one path, `window.copyText()`, which returns what actually happened; `copyAndReport()`
says so. Telling someone their deliberate action worked when it did not is worse than saying
nothing.

---

## Security

| # | Defect | Status |
|---|---|---|
| 23 | **Script execution from a scanned code.** A QR code's content becomes a code's title, and three places wrote that title straight into `innerHTML`: the home-screen icon label, the search results (title *and* payload), and the toast. Scanning a code whose text was `<img src=x onerror=...>` **ran that handler** — verified as execution, not merely markup appearing — with access to everything in `localStorage`. | FIXED |

A QR code is attacker-controlled by definition: anyone can print one and leave it on a wall. The
Library rows and the batch tray already handled this correctly and carry a comment naming the
rule, which is exactly what makes it worth a standing test — **the rule existed and three sinks
missed it.** All untrusted text now reaches the DOM through `textContent`, and a test checks that
ordinary titles containing `<` and `&` still display as typed, so escaping has not become
mangling.

---

## Chased and found not to be a bug

Recorded because "could not reproduce" is a result, and burying it invites someone to chase it
again from scratch.

| Observation | Verdict |
|---|---|
| One failure of *"every dock button opens something"* in a 1,540-execution soak | **Unreproduced.** 65 further runs at two and four workers were clean. The soak overlapped edits to `index.html`, so it was very likely testing a half-written file. Unproven either way, so the test's fixed timeouts were replaced with waits on real state — a plausible source of flake removed whether or not it was the one. The test also got 4× faster. |
| `XanNav.stack` empty while history depth was 1 | **Probe artifact.** Caused by a reset loop calling internals directly and bypassing the normal close path. Every real close — X button, Back, Escape, `close()` — leaves the two in agreement. Now asserted, because the invariant was never checked and a phantom entry would mean pressing Back and nothing happening. |

---

## Open — needs the account holder

Neither is reachable from code. The app explains both in words rather than printing an error code.

| # | Item | What to do |
|---|---|---|
| A | Google sign-in blocked on the live domain | Firebase console → Authentication → Settings → **Authorized domains** → add `jerjerrydrive-code.github.io` |
| B | Anonymous sign-in returns HTTP 400 | Either the **Anonymous** provider is off (Authentication → Sign-in method), or the API key carries a referrer restriction (Google Cloud console → Credentials). Not worth guessing between them — check both. |

Everything else in the app works without either.

---

## Known limits of the test harness

Not bugs, but things a green suite does **not** prove. Recorded so nobody reads more into it
than is there.

- **The original long-press bug cannot be reproduced here.** Headless Chromium delivers
  `pointermove` for a small drift but suppresses `touchmove`, which is what the old handler
  cancelled on. Measured, not assumed. The fix stands on its own terms; the test guards the
  current handler rather than demonstrating the old failure.
- **The live site cannot be driven by a browser from here** — the proxy blocks it. Deploys are
  verified by fetching the served file and comparing it byte for byte against the repo, then
  running the suite against those exact bytes.
- **Camera switching between lenses is untested.** The fake capture device presents one camera.
