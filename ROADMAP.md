# XanCode OS — Roadmap to 1.0 and the Native Wrapper

**Target: app feature-complete in ~6 months (Feb 2027), then wrapped for Play Store and
App Store — stores by ~May 2027.**

This is the planning document. The **architecture ledger at the top of `index.html`'s
`<script type="module">` is the source of truth for what is actually built** — this file says
where we're going, that block says where we are. When a phase lands, update both.

## Design sources

Keep these in rotation when building skins and picking palettes:

- **Dribbble — scanner UI**: <https://dribbble.com/search/ui-scanner> — the reference pool the
  morphism skins are drawn from. Screenshots already banked: ScanIT (glass), the white soft-UI
  scanner (neumorphism), the AI OS collage (aurora), plus QR Scanner Pro and Scancam, which are
  feature maps more than style refs — Phases 2 and 3 are largely reverse-engineered from them.
- **Color Hunt**: <https://colorhunt.co> — curated 4-colour palettes. Note the format match:
  Color Hunt palettes are **4 hex colours**, exactly the shape of one 24-char chunk in
  `PACKED_THEMES`. Any palette from there can be appended to the packed string as-is. That is the
  intended way to grow the palette beyond the recovered 338 — append, never rewrite.

---

## Where things stand today (Aug 2026)

Built and covered by the regression suite (`npm test`, 82 passing in ~85s):

| Area | State |
|---|---|
| Home screen | Paged icon grid, **folders**, **named pages**, floating dock, physics drag-reorder, swipe-down search, edit mode |
| Codes | **22 Quick Add types in 4 categories**, **11-format browser**, **per-code colours with a scannability validator**, item viewer |
| Scanner | Multi-camera, autofocus, zoom, torch, 4K→1080p fallback, **scan-from-image**, **batch mode**, **12-type payload parser**, share |
| Library | **Saved / Scanned / Created** switch, starred favourites, **multi-select bulk delete/export**, filter + sort |
| Theming | 338-theme recovered palette, 1352 reachable accents, reroll + pin, WCAG-measured accent text |
| Skins | **6** — `dock`, `scancard`, `glass`, `soft`, `aurora`, `classic`, all over one DOM via `OSSkinManager` |
| Settings | Grid density, auto-arrange, wallpaper, accent, skin, Vibration & Animations, **backup / restore / CSV** |
| Platform | Installable PWA, **fully self-contained** (no CDN needed to render), Firebase cloud sync (strictly optional) |

The foundation is done. Everything below is building **on** it — never forking it (HARD RULE 5).

---

## Phase 1 — The Morphism Skin Family ✅ COMPLETE
**Months 1–2 · Sep–Oct 2026**

Four new skins. Each is one `SKINS` entry plus one `body[data-skin="..."]` CSS block, over the
same DOM and the same interaction contract. `scancard` is the template to copy.

| Skin | Aesthetic | Reference |
|---|---|---|
| `glass` ✅ | **Shipped.** Ambient colour field behind frosted translucent chrome. Tints entirely from `var(--accent)` via `color-mix()`, so it follows the user's theme rather than pinning the reference's lavender — the pattern the other three should copy | ScanIT |
| `soft` ✅ | **Shipped.** Neumorphism — surfaces the same colour as the ground, separated only by a two-light shadow pair. Covers the wallpaper (extruded shadows need a flat ground) and inverts text polarity, both of which `aurora` will need too | white QR-scanner |
| `aurora` ✅ | **Shipped.** Drifting colour blooms behind near-black glass. Keeps the native dark polarity, so no text inversion — the structural difference from `soft`. Blooms derive from `var(--accent)` against three fixed anchors, near-even so they stay distinguishable | AI OS collage |
| `classic` ✅ | **Shipped.** The original, polished — every change targets a named defect (halo'd label shadow, 12%-opacity icon shadow, undefined plate edge, labels floating between rows). A test enforces the contract: treatment may change, layout geometry may not | our own v2 |

### Open decision — the polished *XanCode alpha*: skin or separate app?

The old alpha "gives different vibes", and that instinct is worth trusting rather than
overriding. The distinction that decides it:

- **If it's a re-skin** — same paged home screen, same drag-to-reorder, same item viewer, just a
  different visual language — it is a `SKINS` entry. Cheap, and it inherits every fix forever.
- **If it's a different information architecture** — the alpha's bottom-tab
  History / Create / Scan layout, where the home screen is *not* the centre of the app — then it
  is **a separate project, and forcing it into a skin is the exact mistake that destroyed this
  codebase once already.** HARD RULE 5 exists because an old paradigm and a new one got merged
  into one file and ate each other.

Current read: the alpha is the second kind. **Recommendation: build it separately, after 1.0**,
sharing code deliberately — the packed palette, the payload parsers, the generator — via
extraction into a small shared module rather than by copy-paste or by cramming both UIs into
`index.html`. **Phase 1 is now done, so this is decidable.** The evidence: six skins shipped over one
DOM with zero forks, including two that invert polarity or own the backdrop entirely. The skin
system comfortably handles *visual* range. What it was never asked to do is change the
information architecture — and that is precisely what the alpha needs. The recommendation
therefore stands, now on evidence rather than caution: build it separately, after 1.0.

**Definition of done:** every skin renders home / library / scanner / generator / viewer with no
layout breakage; switching skins never touches `OS_STATE`; each skin's accent surfaces read from
`var(--accent)` (HARD RULE 7); one Playwright test per skin asserting it applies and the home
screen still renders.

**Watch for:** skins that need new DOM. If one genuinely does, add it to the shared markup hidden
by default and let every skin opt in — do not fork the structure.

---

## Phase 2 — The Create Engine ✅ COMPLETE
**Months 2–3 · Oct–Nov 2026**

~~Today: 7 Quick Add templates.~~ **Done: 22 types across four categories**, on a declarative
registry — each entry carries its fields and a `build()`, so adding a type is one object rather
than an arm in two parallel switch statements. ~~the format browser~~ is done too — 11 symbologies with plain-language blurbs, searchable
across them, plus per-format input validation that closes a silent render failure. **Phase 2 is done.**

- **Socials:** Instagram, WhatsApp, X, Facebook, YouTube, TikTok, LinkedIn, Telegram, Snapchat, Pinterest
- **Personal:** Email, Phone, SMS, vCard/MeCard, Calendar event, Location/Geo
- **Utilities:** Plain text, URL, WiFi, App Store link, Clipboard capture, Crypto address
- ~~**Format browser**~~ ✅ 11 symbologies (Aztec, QR, Data Matrix, PDF417, Code 128, Code 39,
  Code 93, EAN-13, EAN-8, UPC-A, ITF), each with a plain-language "what is this for" line, and
  search that matches those blurbs. Every one is verified to encode in bwip-js by test, and each
  1D format's real input rules are enforced before save

~~**Code styling**~~ ✅ foreground/background pickers drawing on the recovered 338-theme palette,
with a live **scannability validator**. It judges two things, and the second is what a
contrast-only check gets wrong: inverted white-on-black scores a perfect 21:1 and still fails on
most 1D readers, so the same pair is a hard fail on EAN-13 and a warning on QR. `warn` still
saves; only `fail` blocks. All rendering moved to one `renderCode` path so colours apply in every
surface.

Deferred to a later pass: corner-dot styling and centre-logo embedding. Both are cosmetic;
the scannability engine they'd need is now in place.

**Definition of done:** every type produces a payload verified to decode correctly by a round-trip
test (generate → decode → compare). Aztec stays the default everywhere (HARD RULE 6).

---

## Phase 3 — The Scan Engine ✅ COMPLETE
**Months 3–4 · Nov–Dec 2026**

- ~~**Batch scanning**~~ ✅ continuous mode, running tray with per-item removal, save-all
- ~~**Scan from image**~~ ✅ pick a photo or screenshot; decoded via `scanFile`
- ~~**History** split **Scanned** vs **Created**~~ ✅ with relative timestamps, capped at 200,
  device-local by construction, with starred favourites that pin above every sort order
- ~~**Contextual result actions**~~ ✅ `window.parsePayload` classifies 12 types (URL, bare
  domain, WiFi, vCard, MECARD, calendar event, geo, crypto, email, phone, SMS, retail barcode,
  plain text) and returns the one action worth offering. Product barcodes get **"search info in"**
  buttons for Google / Amazon / eBay / DuckDuckGo. The parser is pure — it describes, never
  navigates — which is what makes it fully testable without a camera
- ~~**Result action bar**~~ ✅ Retake · Copy · Share · Save. Share uses Web Share with a
  clipboard fallback; a cancelled share is not reported as an error

**Definition of done:** every payload type has a tested parser and a tested action; unknown
payloads degrade to plain text with copy/share, never an error.

---

## Phase 4 — Organisation & Data Ownership 🔨 IN PROGRESS
**Months 4–5 · Dec 2026–Jan 2027**

- ~~**Folders**~~ ✅ drag an icon onto another and dwell to merge; a quick pass still
  reorders. Membership is derived (codes carry a `folderId`, folders hold no child list), so
  nothing can drift. Under two codes a folder dissolves; deleting one frees its contents
- ~~**Named pages**~~ ✅ a chip above the page dots, editable in edit mode; syncs and is
  backed up. Page reordering still to do
- **Tags + starred** codes, surfaced as Library filters
- ~~**Full export / import**~~ ✅ JSON backup of every code, history entry and setting
  (wallpaper included — a local file has no Firestore size cap), plus CSV export. Restore
  **only ever adds**: codes merge deduped by payload, so it can never delete what is already
  on the device. Bad files fail cleanly with state untouched
- ~~**Bulk operations**~~ ✅ multi-select in the Library → export selection as CSV, or
  delete. Selection clears on any view change so Delete can never reach something off-screen,
  and it only ever touches the active source. Move/tag still to do
- **Widgets**: a "most-used code" quick-access surface

**Definition of done:** a user can get all their data out in one tap and restore it on a fresh
install with nothing lost. This is the phase that makes the app trustworthy enough to depend on.

---

## Phase 5 — Polish, Access & Hardening
**Months 5–6 · Jan–Feb 2027**

- **Accessibility** — partly done early, driven by an audit against Apple HIG + WCAG 2.1:
  ~~44x44pt minimum tap targets~~ (audited by measuring the rendered app; close buttons were
  36-40sq, pills/segments 34-38 tall, the search input 23 tall — all fixed and pinned by a test
  that also counts invisible hit-area extensions) and ~~`prefers-reduced-motion`~~ (there was no
  handling at all, in an app with jiggling icons, spring modals and a full-screen morph pulse).
  Still to do: full keyboard navigation, screen-reader labels on every control, focus
  traps in modals. The accent contrast
  calculator is **partly done early** — it now measures real WCAG luminance (95% of the palette
  meets AA, up from 83%); the remainder needs an `--accent-strong` darkened fill so white text
  can be used on light accents without failing
- **Internationalisation**: extract every string to a table, ship English + 3 more, RTL layout
- ~~**Self-host the CDN dependencies**~~ — **done early**, pulled forward out of necessity. See
  risk 2. Remaining performance work: sub-1s first paint on real hardware, and trimming the
  vendored bundles (bwip-js ships every symbology; we use five)
- **Haptics & audio** (the old Phase 8 idea): Web Audio click on icon snap, muted thud on delete
- **Error surface**: XanLogger gains an in-app diagnostics view
- **Security pass**: audit every dynamic-content path against HARD RULE 8

**Definition of done:** Lighthouse ≥95 across the board; suite green with zero CDN dependencies.

---

## Phase 6 — Native Wrapper
**Months 6–9 · Feb–May 2027**

**Use Capacitor.** The app is already a single-file offline PWA, which is exactly Capacitor's
happy path — it wraps the existing `index.html` unchanged and swaps in native plugins where the
web APIs are weaker. Not React Native, not a rewrite: nothing in the current codebase gets thrown
away.

Native capabilities to adopt via plugin:
- Camera (replaces the html5-qrcode path with the platform scanner — faster, better low light)
- Haptics (real taptic feedback instead of `navigator.vibrate`)
- Share sheet, filesystem export, clipboard
- Home-screen widgets (per-platform, the one genuinely native-only build)
- Push, only if a real feature needs it

Store work, which is the part people underestimate:
- Apple: developer account, privacy nutrition labels (camera + optional account), App Store
  screenshots per device class, review notes explaining camera use
- Google: Play Console, data-safety form, target-API compliance, closed → open testing track
- Both: icon sets, splash screens, versioning, crash reporting, a support URL and privacy policy

**Definition of done:** signed builds on both stores' testing tracks, installed and smoke-tested
on real hardware, with the PWA still shipping from the same source.

---

## Timeline

| Months | Window | Phase |
|---|---|---|
| 1–2 | Sep–Oct 2026 | Morphism skin family |
| 2–3 | Oct–Nov 2026 | Create engine |
| 3–4 | Nov–Dec 2026 | Scan engine |
| 4–5 | Dec 2026–Jan 2027 | Organisation & data ownership |
| 5–6 | Jan–Feb 2027 | Polish, access & hardening |
| **6** | **Feb 2027** | **App feature-complete — 1.0** |
| 6–9 | Feb–May 2027 | Native wrapper & store submission |

Phases overlap at the seams by design — skins keep getting refined while the Create engine is
being built.

---

## Standing risks

1. **Scope creep through skins.** Every new aesthetic tempts a DOM change. The moment a skin
   forks the structure we are back to the failure that destroyed the alpha. Skins are CSS.
2. **CDN dependency — found, measured, and fixed.** Every external request failed in a
   restricted environment, and Tailwind failing took essentially all the layout with it: the app
   rendered as unstyled scattered text while the whole regression suite stayed green, because it
   asserted behaviour and DOM rather than pixels. Tailwind, lucide, bwip-js and html5-qrcode are
   now vendored same-origin and the default wallpaper is a painted gradient, so the app renders
   with no network at all. Boot went from ~25s to near-instant; the suite from 3.2min to ~20s.
   A test now blocks every external host and asserts a complete render. Firebase stays on a CDN
   by design — cloud sync needs the network anyway and already fails gracefully.

3. **The palette is irreplaceable.** The 338-theme string was lost once and recovered by luck.
   It is in git now and pinned by a test — never "tidy" it.
4. **Store review friction.** Camera-permission apps get scrutinised. Budget a rejection round.
5. **Six months to feature-complete is achievable but has no slack in it.** Phases 2 and 3 carry
   the most unknowns (payload parsers and camera behaviour across real devices), and they are
   where overrun will show up first. If something has to give, the honest order to cut is:
   trim the Phase 2 type list, then defer widgets from Phase 4 — never Phase 5. Shipping
   inaccessible or unhardened to hit a date produces something less trustworthy, not earlier.
6. **Splitting the alpha into its own project doubles the surface.** If that decision lands
   (see Phase 1), the shared logic must be *extracted* into a module both consume. Two diverging
   copies of the generator and parsers is the same failure as the skin-fork, one layer up.

---

## Working rules

The HARD RULES in `index.html` are not style preferences — each one is a bug that already cost
this project real work. Read them before every change. In particular: localStorage is always the
source of truth, skins never fork the DOM, Aztec stays the default, colours go through
`var(--accent)`, scanned payloads never touch `innerHTML`, and every real fix or feature lands
with a test in the same change.
