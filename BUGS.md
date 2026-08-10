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
| 26 | "it doesn't seem to register touches for buttons very well. I can barely back out of a barcode after the card opens up" | Four invisible buttons from the **closed** scanner sat hit-testable at z-index 300 — the topmost layer in the app — as 48px discs across the top of *every* screen. See below. | FIXED |

`pointer-events: none` is an inherited **value**, not a switch that disables a subtree: a
descendant setting `auto` opts itself back in. The scanner's header buttons each do that, and
they must — their own parent is `none` so taps reach the camera behind it. Nothing then turned
them off when the scanner closed.

The word in the report that identified it was **"barely"**. The viewer's close button is a circle
at (24,64) 48×48; the scanner's close button is a circle at (24,56) 48×48 directly on top of it.
Two circles offset by 8px leave a thin crescent at the bottom of the viewer's button that still
worked — so closing a code succeeded roughly one attempt in several rather than never. A bug that
never worked would have been found long ago; one that *usually* fails reads as "the phone is being
slow".

The other three discs sat over the top-right corner of every layer. One of them opens a file
picker.

Fixed at the layer, not at the four buttons: `.modal-spring.pointer-events-none *` is
`pointer-events: none !important`, keyed on the class all nine layers already toggle, so a layer
added later is covered without anyone remembering this. The guard is a sweep of every point on
the screen at three viewport sizes, failing if anything the user cannot see would receive the tap
— four of the five new tests fail against the previous build. A fifth checks the rule does not
leak into the *open* scanner, which would be a worse bug than the one being fixed.

Also measured while here, and **not** a bug: `.tap-extend::after` genuinely extends the hit area —
a dispatched touch 5px outside a 29px-tall button's border box registers a click. That had been
assumed rather than verified.

| # | Defect | Status |
|---|---|---|
| 27 | **The same dead end, through the keyboard.** `pointer-events` says nothing about focus or the accessibility tree, so fixing #26 fixed only the finger. Measured from the home screen: five presses of Tab walked into the closed search overlay, then the closed Library, then the closed Settings sheet — which alone holds **357** focusable controls, because every theme swatch is a button. Roughly 390 invisible controls, with nothing drawn to say where you were or how to get out. | FIXED |
| 28 | Every icon carries an invisible "remove this code" button. `.edit-only` was `opacity: 0` outside edit mode — invisible, unclickable, and **still a tab stop**, so tabbing across a full home screen passed through 43 delete buttons. | FIXED |

This is bug #1 again — *"I get stuck in a lot of pages and cant go back"* — arriving through a
different input device. `XanNav` exists because that report was about the finger; nothing had ever
asked what the same layers do to a keyboard.

Closed layers now carry `inert`, which is the only thing that covers hit-testing, tab order and
the accessibility tree at once. It is set from `XanNav._sync`, the same MutationObserver that
already mirrors these layers into history, so a layer added later is covered without anyone
remembering the rule — and edit mode is skipped, because it is registered against `<body>` and
making the document inert would disable the whole app. `.edit-only` is now `visibility: hidden`,
delayed by the length of its own shrink-away so the exit still animates.

Two of the four tests fail against the previous build. The other two are the ones that matter
longer term: that opening a layer still clears `inert` and its input still takes focus, and that
`<body>` is never made inert. A fix that silently stops the search field accepting the keyboard
would be worse than the leak it replaced.

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

| # | Defect | Status |
|---|---|---|
| 24 | **Formula injection in the CSV export.** Cells were quoted but not defused. Excel, Sheets and LibreOffice treat a cell beginning `=` `+` `-` `@` (or tab/CR) as a **formula regardless of quoting**, so a scanned code reading `=cmd|'/c calc'!A1` exported cleanly and executed when the file was opened — and export-then-open-in-Excel is the entire point of the button. Verified with five payloads including `IMPORTXML`, which exfiltrates silently with no prompt. | FIXED |

Same shape as #23: attacker-controlled scanned text reaching a context that interprets it. Both
export paths had their own escaper; there is now one `window.csvCell()`, so a fix to one cannot
miss the other. A test checks ordinary URLs and WiFi strings export unchanged.

---

## Data loss

| # | Defect | Status |
|---|---|---|
| 25 | **Signing in destroyed everything on the device.** `applyRemoteState` did `OS_STATE.apps = data.apps` unconditionally, so the account's contents replaced the phone's. Measured: 50 local codes became 2. An account whose document existed but was empty took 10 local codes to **zero** — `Array.isArray([])` is true, so an empty document passed the guard. `queueSave` then pushed that result up and made it permanent. | FIXED |

The worst defect found: silent, irreversible, and triggered by the most ordinary action there is.
Restoring a backup already refused to delete anything ("Restoring only ever adds"); signing in is
the same promise and now keeps it.

The **first** snapshot after sign-in is a reconciliation — a union by id, remote winning on
conflict, local-only codes kept and given free slots so two never share one square — and the
result is pushed back up so the other device gains them too. Every **later** snapshot stays
authoritative, so deleting a code on another device still propagates; otherwise nothing could
ever be deleted. Switching accounts reconciles again rather than wiping.

Six tests, five of which fail against the previous build. (The sixth — that the merge is pushed
back up — passes either way, because the old code pushed unconditionally.)

---

| # | Defect | Status |
|---|---|---|
| 29 | **A save that never happened, reported as success.** `saveState()` swallowed the quota error and returned nothing, while **two** call sites were written as `try { saveState() } catch` — expecting a throw that could never arrive. Both failure paths were dead code. | FIXED |

Setting an oversized wallpaper toasted "Storage Limit Reached!" and then **"Wallpaper updated!"**
straight over the top of it, applied the image to the screen and revealed the Reset button —
every visible signal said it worked. Restoring a backup whose wallpaper pushed it past the quota
returned `{ ok: true, error: null }`, "Restore complete", having written nothing at all: the whole
backup was gone on the next launch.

Worse than either: the unsaveable value stayed in `OS_STATE`, so **every later save hit the same
quota and failed too**. Measured — after one oversized wallpaper, a code added afterwards did not
persist, and the reload came back with neither. From that moment until the app was restarted,
nothing the user did was kept, and it never said so.

`saveState()` now returns whether the write landed, the same rule as `window.copyText()`.

| # | Defect | Status |
|---|---|---|
| 30 | **The wallpaper picker never worked on a phone.** A camera photo is 3–8MB; localStorage holds about 5MB in total, shared with every code. Stored at full resolution it failed for essentially every real photo — on the one device the feature exists for. | FIXED |

Now redrawn to 1600px on the longest edge and encoded as JPEG before saving. Measured: a
4032×3024 photo (33MB of raw noise, the worst case) stores as 673KB and survives a reload. If it
still will not fit, the previous wallpaper is restored rather than cleared, and the message says
so. Non-image files are refused instead of stored.

All five tests fail against the previous build.

---

## The launcher revamp

> "the edit function is hard to find the right spot to activate it. I response via vibration
> feedback anywhere I tap tho but nothing happens ... we continue to fail that section and need
> to work on a full revamp of that section because patches and patches doesn't work"

The user was right that patching had failed — three separate rounds of threshold tuning
(bugs #2, #6, #7) had each been reported broken again. The reason is that **the thresholds that
decided the outcome were the browser's, not the app's.**

| # | Defect | Status |
|---|---|---|
| 31 | **A tap that drifted more than ~15px did nothing at all.** The grid lived in a native scroll-snap container and icons were activated by the synthesized `click`. Measured: 0px, 4px, 8px, 12px of horizontal drift opened a code; **16px and beyond did nothing**, with `pointercancel` fired and no `click` ever dispatched. Disabling the scroller (`touch-action: none`) removed the `pointercancel` — and `click` *still* did not arrive past ~15px, because that is Chrome's own tap slop and it is not configurable. | FIXED |

16 CSS px is about **2.5mm**. Meanwhile the haptics and the long-press timer ran on pointer
events, which fire regardless — so the phone buzzed on essentially every touch while nothing
happened. That is the report exactly: *vibration anywhere, action almost nowhere.*

`LauncherInput` now arbitrates every gesture on the launcher surfaces: one state machine,
`touch-action: none` so nothing is ever stolen, activation dispatched on pointerup, paging
driven from the pointer, and haptics only where something commits.

### Four more defects found while building it — three of them in the new code, before release

| # | Defect | Status |
|---|---|---|
| 32 | **Click-through.** Acting on pointerup means the screen has already changed when `click` is dispatched, so it landed on the viewer's own backdrop — whose handler closes it. Every tap opened a code and shut it again. | FIXED |
| 33 | **A long press opened the rename dialog.** The click synthesized after the press landed on the icon still under the finger, which in edit mode means Rename. Long-press to rearrange, get a rename box. | FIXED |
| 34 | **`PhysicsDragEngine.destroy()` never cleared `targetEl`.** Anything asking "is a drag in progress" got yes forever after. One trip through edit mode killed every tap and every swipe until reload. Pre-existing; only exposed because the arbiter asks that question. | FIXED |
| 35 | **A page turn depended on luck.** Snapping to the *nearest* page needs the finger past half the screen, minus the slop the pan does not count: a 200px swipe on a 390px page moved the grid 175px — 45% — and snapped straight back. Whether the page turned rested entirely on whether the flick happened to clear the velocity threshold. | FIXED |

\#35 surfaced as a test failing **three runs in eight**, and was fixed by making the behaviour
correct rather than by retrying: distance *or* speed commits, with a quarter of a page as the
commit point. Ten of ten after. This is the second time the "never retry a flake away" rule has
paid for itself — an intermittent test is a user being ignored at the same rate.

A browser smooth scroll cannot be cancelled and it *wins*, so the snap is animated in
`requestAnimationFrame` and every page move in the app routes through it. Otherwise a second
swipe during the first one's animation was simply overwritten.

Twelve tests, five of which fail against the previous build.

---

## The same defect, everywhere else

The launcher was not the only place it hurt. When the browser decides a touch is the start of a
pan it sends `pointercancel` and **never dispatches `click`** — measured on the Settings button:
`pointerdown`, then `pointercancel`, full stop.

| # | Defect | Status |
|---|---|---|
| 36 | **Every button in the app failed at ~20px of drift.** About 3mm. Opening Settings did nothing, opening Account did nothing, the Library's Recent/Name/Format chips did nothing. Every one worked perfectly with a mouse, which is exactly why a green suite never showed it. | FIXED |
| 37 | **The two most-used controls on the home screen were 30×30px.** Account and Settings, both well under the 44px minimum. Bug #9 swept five undersized controls and never reached these, because it opened *layers* and these live in the header. | FIXED |
| 38 | `.tap-extend` only ever grew the **height**. Enough for a wide short chip, useless for a small square control — the header buttons stayed 30px wide however much the helper was applied. | FIXED |

`TouchTap` watches **touch** events, which keep firing through a cancel, and activates the control
only when the finger ended within it, within 24px of where it started, and the browser dispatched
no click of its own. That last condition is what makes a double activation impossible — on a
delete button, firing twice is unrecoverable.

Forcing `touch-action: none` onto every control also works and was **rejected**: it would mean a
list could not be scrolled by a finger that happened to land on a button inside it. Scrolling is
left exactly as it was.

Five tests, three of which fail against the previous build. The other two are the ones worth
having later: that a drag starting on a control does not activate it, and that an ordinary tap is
never delivered twice.

---

## Restoring

> "I cant figure out how to import these. or what file is expected to import it's not the same as
> export so its fucking stupid"

| # | Defect | Status |
|---|---|---|
| 39 | **The importer refused anything without a header the user never wrote.** It demanded `format: 'xancode-os-backup'` and answered everything else with "That is not a XanCode OS backup file" — standing between someone and a file full of their own codes. | FIXED |

A restore only ever **adds**, so being generous about the shape costs nothing and refusing costs
someone their codes. It now takes the list from wherever it is: the app's own export, a
`{state: {...}}` with no header, a bare `{apps: [...]}`, a bare array, or a list under `codes` /
`items` / `barcodes`.

Generous is not credulous. A file with nothing code-shaped in it is still refused **with a
reason**, and a backup claiming a newer version is still refused — silently "succeeding" on a
file that held nothing would be defect #29 all over again.

An array under a name meaning "the codes" is taken at its word even when empty, because a backup
of an empty app is still a backup and carries the skin, accent and page names with it. That case
was missed on the first attempt and caught by a test written for it.

---

## Found by a budget test failing only under load

| # | Defect | Status |
|---|---|---|
| 40 | **Opening a code still blocked before the layer appeared.** Defect #20 deferred the *canvas* to the next frame and left `populateEnlargeExtras` where it was — and that runs two whole-document lucide sweeps. Measured with 198 icons on the page: 10.3ms total, **9.9ms of it in the extras**, all of it spent before the layer was made visible, which is the exact thing the deferral exists to prevent. Under parallel load it reached 35ms and blew the two-frame budget. | FIXED |

Same shape as #19, where the toast swept every icon in the document to draw one of its own.

**The first fix was wrong and the motion audit caught it.** Moving the extras into the opening
`requestAnimationFrame` did not remove the 10ms, it relocated it into the first frame of the
transition — so instead of delaying the animation it stalled it, and the audit started reporting
a finding in **half** its runs where it had been clean all day.

The right answer was to stop doing the expensive thing at all. `toastIcon` was generalised into
`iconSvg`: one document sweep per distinct icon name, ever, and a string thereafter. The extras
went back to being synchronous, because they now cost nothing.

| # | Defect | Status |
|---|---|---|
| 41 | The generalised cache was **not warmed**, so the FIRST code opened still paid five sweeps — 35–42ms against a two-frame budget, while every later open was 0.4ms. The app already warms the two toast icons at init for exactly this reason; the viewer's five were missed. | FIXED |

Measured end to end: **10.3ms → 0.4ms**, zero document sweeps, and the first open is no longer a
special case. A cost that only lands once is still a cost, and it lands on the first thing the
user does.

Worth recording **how** all of this was found: a budget test that only failed under contention.
The temptation is to widen the budget or blame the machine. Twice, the measurement said
otherwise — and the second time, the thing it caught was my own fix.

---

## Fixed in the tests, not the app

Two tests failed intermittently under parallel load and neither was an app defect. Both are
recorded because "it was the harness" is a conclusion that has to be earned, not assumed.

| Test | Why it flaked | What changed |
|---|---|---|
| *swiping across a page in edit mode turns the page* | The app separates a page swipe from a deliberate drag by **speed** (`QUICK_MS`, 180ms) — direction cannot be used, because reordering within a row is horizontal too. The harness cannot deliver a gesture that fast: four mouse moves with no sleeps measured **436ms, 547ms, 752ms** under four workers. | `performance.now()` is frozen for the length of the gesture, so the app measures what a real thumb would give it. The drag engine's own logic still decides. 10/10 under load after. |

The other, *a held finger that drifts a few pixels*, passed 12/12 under the same load once
re-run and was not changed.

---

Audit rate after the fix: **15 clean runs in 16**, against 3 in 4 before it. One run reported
**two** findings — note two, where the original was consistently one — and did not reproduce in
ten further runs, so it could not be captured or named. Recorded here rather than rounded down to
zero: the direct measurement above is what the fix rests on, and that one observation is
unexplained.

---

## Found by asking what the app lets you create

| # | Defect | Status |
|---|---|---|
| 44 | **A code could be saved that can never be drawn.** A 3000-character QR throws `qrcodeNoValidSymbol#20217` inside bwip-js; a 5000-character Aztec throws a TypeError. Both were accepted by the form, saved, and reported as **"Added to Grid!"** — leaving a tile that is blank forever, cannot be scanned, and that nothing in the app repairs. | FIXED |
| 45 | **A code could be saved that is too wide to scan.** 500 characters of Code 128 encodes happily into a canvas **16,605px wide**: a large allocation, unreadable on a phone, unscannable in the real world. | FIXED |

`CODE_FORMATS` already carried per-format rules, but every one of them covers *shape* — digits
only, even length, correct check digit. Nothing covered **capacity**, which depends on the data as
well as its length and differs per error-correction level.

`window.canEncode()` asks the encoder instead of copying a capacity table that would be wrong the
day bwip-js changes: it tries the encode and reports what happened, mapping the failure to
something useful — *"That is more data than this format can hold. PDF417 handles the most, then
QR."* Run on save, not on every keystroke.

Same family as the storage defects: an operation the user asked for, reporting success it did not
have.

The check sits on the same path a **scanned** code takes, so the fourth test is the one that
matters longest — fourteen realistic payloads (WiFi, vCard, TOTP, unicode, Japanese, emoji, GS1,
boarding pass) must still save. A scanned code the app refuses to keep would be worse than one
that draws badly. Three of the four tests fail against the previous build; that fourth passes both
ways on purpose.

---

## Found by asking where a code goes when a folder ends

| # | Defect | Status |
|---|---|---|
| 46 | **Deleting a folder hid the codes it held.** Every child was given `order = 999`, so they all landed on the *same* square — where only one can be drawn. Measured through the app's own edit-mode delete: a folder of three left two codes at page 1 order 15, both invisible. Still in storage, still in the Library, gone from the home screen with nothing to say why. | FIXED |
| 47 | **Deleting a folder's codes from the Library stranded the folder.** Delete all of them and an empty folder stayed on the grid, opening to nothing. Delete all but one and a folder of one survived — which `removeFromFolder` itself calls "an item wearing a costume". | FIXED |
| 48 | **A code pointing at a folder that no longer existed was invisible twice over** — skipped by the grid because it has a `folderId`, and unreachable because there is no folder left to open. | FIXED |

The comment on `order = 999` said *"the renderer packs it in"*. That is true only when
auto-arrange is on; it is **off by default**, and the renderer then does
`if (item.order < itemsPerPage) slots[item.order] = item`, so 999 is silently dropped.

`window.firstFreeSlot()` and `window.placeOnGrid()` are now the single answer to "where does this
code go?", asked identically when a code is created, when one leaves a folder, and when a folder
is dissolved. The three call sites had drifted apart, which is how the same value ended up
assigned to three codes at once.

The folder invariants are kept in **one** place — `window.tidyFolders()`, called from
`Renderer.render()` — rather than at each delete site, because the delete sites are exactly where
they were being forgotten: the Library's bulk delete filters `apps` directly and has no reason to
think about folders. Rendering is the one thing that always happens after the state changes. It is
skipped mid-drag, because a folder is momentarily inconsistent while one is being built and
dissolving it under the finger would be worse than the bug.

All five tests fail against the previous build, and the nine existing folder tests still pass —
creating and merging folders is untouched.

---

## Found by reading every catch block again

| # | Defect | Status |
|---|---|---|
| 49 | **An unreadable saved state silently replaced everything with the demo codes.** The loader ended in `catch (e) { window.OS_STATE = DEFAULT_STATE; }` — one line that threw away the user's data, said nothing, and left the next save free to overwrite the only copy of the original. Measured: twenty codes, a state truncated to 80%, and the app came back showing "My WiFi", "Website" and "Boarding Pass" as though that were normal. | FIXED |

A state truncated to 80% is what a killed tab or a storage fault actually produces, and it is
**not empty** — it still holds most of the codes as text. Three things now happen instead of one:

- **Salvage.** `window.salvageApps()` walks the raw string tracking brace depth and string state,
  lifting every complete record out of the prefix. A regex cannot do this: it cannot tell a `}`
  inside a code's data from the one that ends the object. Measured: **20 codes truncated to 80%
  now recover 15**, where the old build recovered none.
- **Keep the original.** The unparseable payload moves to its own key, so the next save cannot
  destroy it. That is the difference between a recoverable fault and a permanent one.
- **Say so.** A recovery nobody is told about is indistinguishable from the wipe it replaced: the
  user opens the app, sees fewer codes, and cannot tell whether it was them or the app.

Two of the five tests are the ones worth having later, and they pass against both builds on
purpose: that a **healthy** state is never treated as damaged, and that the rescue is written
back so a second reload does not lose it — the same defect one step later.

Also fixed while here: `window.OS_STATE = DEFAULT_STATE` handed out the shared constant, so a
reset app then mutated the defaults in place. It is a fresh copy now.

---

## Reported from a phone, with screenshots

> "I cant get out of edit mode i cant get the moving spots right. try and move the icons around
> to swap spots. its buggy. also when it makes a folder its stuck in folder."

Three separate causes. None was the one the symptoms suggested.

| # | Defect | Status |
|---|---|---|
| 50 | **A drag never ended.** `isEngaged` was set in `engageDrag()` and cleared only when edit mode ended, so after ONE drag it stayed true for the rest of the session. Everything that asks "is a drag in progress" then got yes forever: taps ignored, the background tap that leaves edit mode dead, and the global `touchmove` preventDefault left armed. | FIXED |
| 51 | **A sideways drag was eaten as a page swipe.** The swipe test asked whether the *first move* was ≥18px within 180ms — which made the answer depend on how the browser happened to sample the finger. The same physical gesture is one 40px move on a quiet frame and two 20px moves on a busy one, and only the first counted. Measured: a horizontal drag from slot 0 to slot 3 did nothing at all, twice, while diagonal drags in the same session worked. | FIXED |
| 52 | **No visible way out of edit mode.** Tapping the background works where the background belongs to the launcher, but in edit mode much of the empty screen is the page-move row, which is not a launcher surface — taps there reached nothing at all. | FIXED |
| 53 | **A folder could not be closed.** "Tap outside to close" is a click handler on the overlay, and the overlay is a plain div — not a control, so the tap rescue did not cover it, and the browser withholds the click once the finger drifts. Measured: a dead-still tap closed it, a 25px tap did not. | FIXED |

\#51 is decided on **velocity** now, not on the first sample's distance: a flick is fast from the
first instant, a reorder is a press that becomes a movement, and velocity is the same however the
movement is chopped up. \#52 adds a **Done** button, which is what the original app had. \#53
treats a tap on any `.modal-spring` backdrop as a dismissal, with a slop suited to a full-screen
target rather than to a chip.

Four of the five tests fail against the build the report came from.

### Two existing tests had to be corrected, and neither was the app's fault

The bug #7 guard (*a swipe across a page in edit mode turns the page*) broke on the first attempt
at #51, which used a bigger distance threshold. Velocity satisfies both that guard and the
reorder, which is how you can tell it is the right rule rather than a tuned number.

The bug #2 guard (*a second icon can be moved straight after the first*) dragged to an icon on
**page 1**, off-screen at x=1447. With drags now working, that reaches the screen edge, the
edge-flip turns the page — correctly — and the second press then landed a thousand pixels
off-screen. It had only ever passed because the old build refused the first drag partway. Both
moves now stay on screen, which is what the test was always trying to say.

---

## Chased and found not to be a bug

Recorded because "could not reproduce" is a result, and burying it invites someone to chase it
again from scratch.

| Observation | Verdict |
|---|---|
| One failure of *"every dock button opens something"* in a 1,540-execution soak | **Unreproduced.** 65 further runs at two and four workers were clean. The soak overlapped edits to `index.html`, so it was very likely testing a half-written file. Unproven either way, so the test's fixed timeouts were replaced with waits on real state — a plausible source of flake removed whether or not it was the one. The test also got 4× faster. |
| `XanNav.stack` empty while history depth was 1 | **Probe artifact.** Caused by a reset loop calling internals directly and bypassing the normal close path. Every real close — X button, Back, Escape, `close()` — leaves the two in agreement. Now asserted, because the invariant was never checked and a phantom entry would mean pressing Back and nothing happening. |

---

## Found by chasing the skin morph

| # | Defect | Status |
|---|---|---|
| 43 | **The aurora skin ran the whole app at 17fps.** Not during a transition — at rest, permanently, for as long as it was selected. Every other skin ran at 61. Every tap, swipe and animation in the app inherited it, and nothing in the interface said why. | FIXED |

Found while investigating #42, and much larger than the thing being investigated.

The cause is a `position: fixed`, `inset: -12%` pseudo-element carrying `filter: blur(46px)` and
a 38-second drift animation. A layer that size with a filter that heavy cannot be composited, so
every frame re-rasterises and re-blurs a larger-than-viewport surface. Measured one variable at a
time, at 412×892 with 40 codes:

| variant | fps |
|---|---|
| translate + scale (as shipped) | 14–17 |
| translate only | 17 |
| translate only + `will-change: transform` | 17 |
| opacity only | 23 |
| **no animation** | **61** |

So it was never the `scale()`, and `will-change` does not rescue it — *any* animation on a
blurred full-viewport layer costs the entire frame budget. The field itself, four radial blooms
under a heavy blur, is what the skin looks like and is kept in full; what is gone is an ambient
drift almost nobody would notice, traded for three and a half times the frame rate everywhere.

Result: **17fps → 60fps**, with all six skins now between 59 and 61.

Two tests, both failing against the previous build: one measures every skin's frame rate at rest
with a threshold far below 60, so it catches a skin costing 3–4× the budget rather than policing
normal variation; the other states the rule directly, so a heavy animated blur cannot come back
under a different name.

---

## Sizing the launcher like a launcher

Asked for directly, with a screenshot of a real Android home screen alongside one of this app:
*"do you think we will be able to size it like this"*.

| # | Defect | Status |
|---|---|---|
| 44 | **`--app-size` was a hardcoded 60px on every phone**, whatever the screen. At 412px wide with four columns each cell is 94.8px, so the icon used **63%** of it and floated in the middle — the grid read as small and airy, nothing like the launcher it is modelled on. | FIXED |

Derived from the actual cell now, at 78% of it, so it is right at every width rather than at one:

| screen | icon | fill |
|---|---|---|
| 360×640 | 64px | 78% |
| 390×844 | 70px | 78% |
| 412×892 | 74px | 78% |
| 430×932 | 77px | 78% |

Row spacing scales with the icon, and rows-per-page is computed from the real row height instead
of a constant 88 that no longer described anything.

| # | Defect | Status |
|---|---|---|
| 45 | **The fix above broke the dock.** Its five icons shared `--app-size`, went to 74px inside a 380px bar, and pushed the document **7px wider than the screen**. | FIXED |

The audit reported it as `page scrolls horizontally: 419px of content in 412px` — **63 findings**,
across every skin and every screen size, because a document that scrolls sideways affects every
layer drawn on it and not only the grid it came from.

The dock now sizes from the bar it has to fit inside (54–64px) and is never larger than a grid
icon. **Nothing in the test suite was watching for horizontal overflow**, which is why it took the
audit to find it; there is now a test at five screen sizes, verified by reintroducing the bug and
watching four of them fail.

---

## Fixed after being tracked as open

| # | Defect | Status |
|---|---|---|
| 42 | **The skin morph intermittently left the screen illegible.** `#workspace-container: unreadable (blur ≥4px) for 661ms`, against a 500ms budget. Roughly 1 run in 4. | FIXED |

The obvious explanation was ruled out first: the timers fire on time, and the renders are cheap
(`Renderer.render()` 7.5ms, `SkinManager.render()` 4.2ms with 40 codes).

The actual mechanism is that flipping `data-skin` invalidates essentially every rule in the
stylesheet, and that recalculation lands exactly where the old sequence tried to begin easing the
blur away. **A transition cannot start while the main thread is busy**, so the start slipped and
the screen stayed unreadable long past its budget. Measured over 21 morphs: median 327ms, worst
512, and the long ones lined up with frame gaps of 137–154ms.

Two changes, each doing a different job:

- The ease-out now starts **two animation frames after the swap** rather than at a fixed 260ms.
  The first frame carries the recalculation and repaint; the second begins the ease-out with that
  work behind it. A slow machine now starts a little later instead of starting on time and
  stalling half way through — the difference between a transition that is late and one that is
  broken.
- The pulse blurs to **8px rather than 12**. It exists to hide the swap, and 8px hides it
  completely — verified, the swap happens at 6.6px, above the ~4px legibility threshold. What
  12px bought was 74ms more unreadable screen at each end.

| | before | after |
|---|---|---|
| median span | 327ms | **140ms** |
| worst of 21 | 512ms | **198ms** |
| over the 500ms budget | 1 in 21 | **none** |

Two of the three tests fail against the previous build, and one of them found something the audit
never reported: morphing to and from aurora sometimes left the workspace **still blurred after
1.3 seconds**. The third — that the swap still happens while the screen is covered — passes both
ways on purpose, because it guards the fix from going too far.

---

## Reported from a phone, again — and the second half of it was everywhere

> "the barcodes get stuck in folder just when I try to move them to another's spots. its not
> possible for me to rearrange without glitching into a folder. also I notice a lot of static
> flashes throughout the app all over when interacting."

Two defects, unrelated to each other, both in the code that draws the home screen.

| # | Defect | Status |
|---|---|---|
| 54 | **Rearranging made folders.** The merge dwell started when the finger first entered a target icon's box and then never reset. The reorder swap moves that icon away on the very same `pointermove`, so every later move landed on the *ghost* and took an early return that deliberately left the timer alone — which meant the merge armed 550ms after entering a square no matter how far the finger travelled afterwards. Carrying a code to another code's square means spending time in that square, so a folder was the normal outcome of a reorder. | FIXED |
| 55 | **The whole home screen went blank for a frame on every state change.** `render()` emptied the pager and rebuilt every icon. A code's icon is a `<canvas>` bwip-js fills in 10ms later, so between the rebuild and the redraw the grid was a set of blank white squares. `render()` runs on far more than edits — every drop, every folder change, every resize, every return from a layer — which is why the flashing was "all over". | FIXED |

### 54 — a merge is a decision to hold still

The old rule could only ask *which element* the finger was over. That is not enough to tell two
gestures apart when both of them are over the same element: a reorder ends in the target's square
by definition. Anchoring the dwell to a **position** rather than an element is what separates
them, because that is the difference a person actually performs.

The dwell now restarts whenever the pointer moves more than **10px** from where the hold began,
and an already-armed merge is taken back down by the same movement. The hold itself went from
550ms to **750ms**. A finger that is travelling can never be holding still, however long it
spends over one icon.

Measured with real touch (CDP `Input.dispatchTouchEvent`, 412x892): carrying `bc_1` onto `bc_2`
with a 450ms pause before release now swaps the two codes and creates nothing. Holding still for
1.2s still arms the merge, shows the ring and makes the folder.

Four tests. Three fail against the previous build; the fourth — that a deliberate hold *still*
merges — passes both ways on purpose, so the fix cannot go too far and make folders unreachable.

### 55 — reconcile, do not rebuild

The grid is now keyed by item id. An icon is reused whenever the thing it depicts has not changed
(`itemSignature` covers title, format, payload, colours, badge, and for a folder the first four
codes inside it); moving one between slots or pages is a DOM move, which costs nothing and shows
nothing. Only an icon whose *content* changed is built again. The swap into the pager happens in
a single `replaceChildren` inside the same task the nodes were moved in, so the browser never
gets a chance to paint a half-built grid.

The measurement is taken **synchronously after `render()` returns**, which is the exact frame the
user was seeing. Before: the canvases were new nodes with nothing drawn in them. After: the same
nodes, same ink, 15,300 dark pixels either side.

One trap worth recording, because the first version of the test had it: a canvas that has never
been drawn into is 300x150 of *transparent* black, whose red channel is 0. Counting dark pixels
on colour alone scores a blank icon at 45,000 — the opposite of the answer. The probe checks
alpha as well.

Reusing a node also means its event handlers outlive the object they were built from, so
`openRename`, `openEnlarge` and the folder-dissolve path now look the item up by id at the moment
they run rather than closing over it.

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
