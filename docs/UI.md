# KrishiSathi — Interface & Design System (v14 "Fresh Fields")

This document explains the redesigned interface: what changed, where the
design decisions live, and **how to change them later without touching
component code**. Read this before editing any styling or navigation.

---

## 1. What changed in v14

| Area | Before | Now |
|---|---|---|
| Navigation | 8 links crowded into the top header + a slide-out drawer on mobile | A **bottom navigation bar** (5 tabs) on phones/tablets that becomes a **left side rail** on desktop |
| Structure | One flat header, everything inline | A real app shell: **app bar · content · footer · nav**, plus a **"More" bottom sheet** for secondary features |
| Icons | Hand-drawn inline SVGs (`icons.js`) | **Lucide** icon library loaded from a CDN; `icons.js` builds every glyph from it |
| Colours | Forest green + cream + gold, many one-off values | A single **token palette** (brand / accent / neutrals / semantic) — restyle by editing variables |
| Fonts | Fraunces (display) + Mukta (body) | **Plus Jakarta Sans** (UI) with **Mukta** as the Indic fallback |
| Motion | A few hover states | Page-entrance stagger, sheet/modal/toast animations, micro-interactions — all respecting `prefers-reduced-motion` |
| Theming | Dark mode via many overrides | Dark mode = swapping the tokens under `[data-theme="dark"]` |

Everything is still **vanilla HTML + CSS + JS** — no framework was added.

---

## 2. Where things live

```
public/
├── index.html          ← the shell only: app bar, <nav>, <main>, sheet, modal
├── css/styles.css      ← the whole design system (tokens → components → pages)
└── js/
    ├── app.js          ← ★ NAV + MORE config, router, theme, language, sheet
    ├── icons.js        ← ★ icon library bridge (Lucide) + offline fallback
    ├── views.js        ← one render function per page (unchanged markup contract)
    ├── i18n.js         ← 23 languages
    └── api.js / auth.js / data.js / firebase-config.js
```

The two files marked ★ are the ones you'll touch most often.

---

## 3. Changing the navigation  (the main request)

All navigation comes from two arrays at the top of **`public/js/app.js`**:

```js
const NAV = [                                   // the bottom bar / side rail
  { id: 'home',        href: '#/',            icon: 'home',  i18n: 'nav_home'   },
  { id: 'mandi',       href: '#/mandi',       icon: 'store', i18n: 'nav_mandi'  },
  { id: 'crop-doctor', href: '#/crop-doctor', icon: 'scan',  i18n: 'nav_doctor', center: true },
  { id: 'chat',        href: '#/chat',        icon: 'chat',  i18n: 'nav_chat'   },
  { id: 'more',        href: '#',             icon: 'grid',  i18n: 'nav_more', action: 'more' },
];

const MORE = [                                  // the "More" sheet
  { id: 'weather',  href: '#/weather',  icon: 'cloudSun', i18n: 'nav_weather'  },
  { id: 'sell',     href: '#/sell',     icon: 'scale',    i18n: 'nav_sell'     },
  { id: 'schemes',  href: '#/schemes',  icon: 'scroll',   i18n: 'nav_schemes'  },
  { id: 'settings', href: '#/settings', icon: 'settings', i18n: 'nav_settings' },
];
```

- **Reorder / rename / remove a tab** → edit the array. The bar and the
  sheet rebuild themselves; nothing else needs changing.
- **`center: true`** → that tab becomes the raised primary action in the
  middle of the bar (the centre one only, for best effect).
- **`action: 'more'`** → the tab opens the sheet instead of navigating.
- **`icon`** → any key from `icons.js` (see §5).
- **`i18n`** → a key from `i18n.js`. If you add a brand-new key, add it to
  every language block in `i18n.js` (or it falls back to English).
- The **active tab** is derived from the URL hash automatically; routes that
  live in the sheet keep the "More" tab highlighted.

The same markup drives both layouts — CSS alone turns the bar into a rail
at `≥1024px` (see `.tabbar` in `styles.css`). There is **one nav to maintain**.

---

## 4. Changing the look — design tokens

Open **`public/css/styles.css`**. Everything visual reads from the tokens in
`:root` (§1) and `[data-theme="dark"]` (§2). To re-skin the app, change the
tokens, not the components:

```css
:root {
  --brand-500: #14a86a;   /* brand green ramp 50→950 */
  --accent-500: #f59e0b;  /* harvest marigold */
  --surface:   #ffffff;
  --border:    #e2ebe5;
  --text:      #0f1f17;
  --r-lg: 18px;           /* corner radii: xs sm md lg xl 2xl full */
  --sp-4: 1rem;           /* spacing scale */
  --font: "Plus Jakarta Sans", "Mukta", system-ui, sans-serif;
  --dur-2: 0.25s;         /* motion durations + easings */
}
[data-theme="dark"] { /* the same variable names, dark values */ }
```

Practical recipes:

| I want to… | Do this |
|---|---|
| Use my own brand colour | Replace the `--brand-50…950` ramp |
| Change corner roundness | Edit `--r-*` |
| Change spacing rhythm | Edit `--sp-*` |
| Turn off animations | `--dur-*` to `0s`, or delete the `@keyframes` block (§16) |
| Add a new component | Add a `.your-class` rule in the relevant section; it inherits theming for free |

The stylesheet is organised into 17 numbered sections (tokens → base →
shell → components → pages → animations → utilities) so you can find things.

---

## 5. Icons (loaded from a web link)

Icons come from **Lucide** — <https://lucide.dev> — loaded in `index.html`:

```html
<script defer src="https://unpkg.com/lucide@1.58.0/dist/umd/lucide.js"></script>
```

`public/js/icons.js` reads the raw icon geometry from `window.lucide.icons`
and builds each `<svg>` itself (so icons inherit `currentColor` and our own
sizing). Usage anywhere in the templates:

```js
ICONS.leaf          // → an <svg> string
ICONS['mandi']      // dynamic access works too
weatherIcon(code)   // WMO weather code → a weather glyph
```

A generated `FALLBACK` map inside `icons.js` holds the exact icons the app
uses, so the interface never shows blank icons if the CDN is unreachable
(e.g. a first load with no network). The service worker also caches the CDN
file for offline use.

**To swap to another icon library later:** change the `<script>` in
`index.html`, update `MAP` in `icons.js`, and (optionally) regenerate
`FALLBACK`. Nothing else in the app refers to a specific icon set.

---

## 6. Fonts

Loaded in `index.html` from Google Fonts:

- **Plus Jakarta Sans** — the UI face (headings + body).
- **Mukta** — an Indian foundry font with full **Devanagari** coverage, used
  as the fallback so Hindi/Marathi/etc. render properly. Other Indic scripts
  fall back to the device font.

Change the `--font` token (and the `<link>` in `index.html`) to switch.

---

## 7. Responsive behaviour

| Breakpoint | Layout |
|---|---|
| `< 460px` | Brand wordmark hidden; app bar stays one line; compact language pill |
| `≥ 460px` | Full brand, language pill, theme toggle, account |
| `< 1024px` | **Bottom navigation bar**, content in a single column, footer above the bar |
| `≥ 1024px` | Bottom bar → **left side rail** (`--rail-w`), content in the remaining space |
| `≥ 1280px` | Wider rail |

The nav, the "More" sheet and all cards are single-source and adapt via CSS.
A safety net at the top of `styles.css` (`min-width: 0` + `overflow-wrap`)
guarantees nothing ever pushes the page wider than the screen.

---

## 8. The "More" sheet

`#more-sheet` slides up from the bottom on phones and centres (max 560px) on
wider screens. Its contents are rendered from the `MORE` array. Open/close
is handled in `app.js` (`openSheet` / `closeSheet`); Escape and a tap on the
scrim both close it.

---

## 9. Accessibility & motion

- A **skip-to-content** link, focus-visible rings, and `aria-current` on the
  active tab.
- The sheet and modal are `role="dialog"` with `aria-modal`.
- All animation is disabled under `prefers-reduced-motion: reduce`.

---

## 10. Quick start

```bash
npm install
cp .env.example .env      # add your keys
npm start                 # http://localhost:3000
```

Bump the `CACHE` name in `public/sw.js` whenever you change any cached file
so installed users pick up the update.

---

# v15 — personalised, data-driven interface

## What changed

- **A real data layer (`public/js/store.js`).** The farmer's profile, their
  crops and every production-cost line item live here. Guests get
  localStorage; signed-in users are mirrored to Firestore
  (`users/{uid}.farm`) and re-hydrated on login — so the same farm appears on
  every device. Nothing on the screens is hard-coded any more.
- **Home is a personalised dashboard.** Greeting + season, a **crop-cycle
  status bar** for each crop (stage, days since sowing, days to harvest,
  cost per quintal), a richer weather card, a price card with a **history
  chart**, and a "Today's advisory" list. The login card is gone; the farmer
  is greeted by their first name instead.
- **My Farm (`#/farm`)** — add/edit/remove **multiple crops** (commodity,
  variety, area, sowing date, expected harvest, yield) and manage each crop's
  **production-cost expenses** (add/remove line items → automatic cost and
  cost-per-quintal).
- **Weather** — a richer "now" card (humidity, wind, high/low) and tapping any
  forecast day opens a **detail sheet** (rain, gusts, alerts).
- **Price history** — a real line chart with range and % change, on both the
  dashboard and the Mandi page. The trend is merged with daily snapshots
  stored locally so history builds up over time.
- **Sell Advisor** reads the crop you saved (quantity + total cost) instead of
  asking again, and shows a **pencil/sliders button** to fix the details.
- **Chat** is a full-height workspace, not a small card.
- **Schemes** now use a **"Visit official website"** button (no raw link text)
  plus an **"Ask AI about this"** button that seeds the chat and redirects.
- **The language picker is a bottom sheet** (like the More menu), not a native
  `<select>` dropdown.
- **Desktop rail lists every feature** — no "More" indirection.

## Bug fixes in this round

| Report | Fix |
|---|---|
| Long gap before the footer | `.app-main` bottom padding reduced; the footer itself clears the tab bar |
| Language name not aligned with the globe | reset the global form `margin-top` on the pill |
| Centre (Crop Doctor) tab went white/transparent when active | a more specific rule keeps its gradient |
| "Use my GPS" overflowed when the language changed | new `.btn-row` that wraps instead of overflowing |
| Mic had no way to cancel | tapping the mic again stops it, and any tap elsewhere stops it (auto-stop on silence kept) |
| Icons breaking onto their own line | `.icon` is `inline-block` again |

## Adding your own imagery

The dashboard illustration is `public/assets/farm-hero.svg` — drop in a photo
of the same name (or change the `<img src>` in `views.js`) and the layout
adapts. Scheme/crop icons are Lucide keys in `icons.js`.

## Note on translations

The **79 new strings** were added to the **English** dictionary only. Every
other language falls back to English for those strings via `t()`. To finish
localising them, add the same keys to each language block in
`public/js/i18n.js`.

---

# v16 — fixes, full localisation, PWA icon

## Bug fixes

| Report | Root cause | Fix |
|---|---|---|
| New screens stayed in English | the 99 new strings existed only in `en` | translated into **all 22 other languages** (23 total, 186 keys each) |
| Advisory card pushed right / gap on the left | custom `<ul>`s kept the browser's default 40px indent | `padding-left: 0` on `.advisory-list`, `.diag-list`, `.cost-list`, `.settings-list` |
| Bottom-nav labels truncated ("Mandi Pric…") | single-line labels | labels wrap to two lines; tab bar 74px |
| Mandi always showed "cached" | the server caches for 30 min | `?fresh=1` on an explicit "Show prices" tap bypasses the cache and falls back to cached data only if the live call fails |
| "Invalid Date" everywhere | AGMARKNET returns `DD/MM/YYYY` | `parseDate()` understands `DD/MM/YYYY`, ISO and Date objects |
| Sell advice button vanished after changing crop | `renderSummary()` wiped the button that was appended after it | the button is part of the rebuilt panel; clicks are delegated |
| "Add your first crop" did nothing on My Farm | it linked to `#/farm` — the page you were already on | on the farm page it opens the crop form |
| Settings "Edit" was meaningless/static | placeholder buttons | real Language + Theme rows, saved on the device, plus **Reset to default** |
| Data survived logout | nothing cleared it | `store.clearLocalData()` on logout wipes the farm, chat logs, diagnosis history, price snapshots and weather memory; the cloud copy is re-fetched on next login |
| Weather icons looked wrong | one flat colour | icons are tinted per condition (sun amber, rain blue, storm violet, snow cyan, cloud grey) |
| AI always answered with a table | no instruction | the system prompt now says prose unless a table is asked for |
| Crop Doctor history was a bare table | only a headline was stored | full diagnoses are stored (Firestore + device) with the Cloudinary photo; tap an entry to expand it |

## New

- **Home price card** follows the crop you grow (with a picker when you grow
  several), shows a **▲/▼ trend pill** and a history chart coloured by
  direction — green rising, red falling, amber steady.
- **Harvest date**: leave it blank and it is estimated from the sowing date +
  the crop's typical duration (shown with "(estimated)"). The estimate also
  drives the crop-cycle bar.
- **Reset to default** in Settings clears language, theme and this device's data.
- **PWA icon** is the app's own sprout logo (green gradient) at 180/192/512.

### About the price history

AGMARKNET gives *today's* prices across markets; the trend inside one response
covers only the last few arrival dates. The app therefore also stores one
snapshot per day per commodity+state on the device (`ks_price_hist_*`), and the
chart merges the two — so the history gets richer the longer the app is used.
For a long, deep history from day one you would need a paid historical-price
source (e.g. a data.gov.in historical dump, Agmarknet archives, or a commercial
API); nothing extra is required for the colour-coded trend as it stands.

---

# v17 — round-2 fixes

| Report | Fix |
|---|---|
| Crop-cycle card: the stage badge squeezed the crop details into thin columns | the badge moved onto the **name row, top-right**; the details line now has the full width. Long crop names wrap inside their own space |
| Big photos were slow and failed to reach Cloudinary, so history had no image | photos are **downscaled to under 1 MB** in the browser (max 1280px, JPEG) before upload; already-small photos are untouched |
| No "speak out loud" on the diagnosis | the diagnosis card has a **speak button** (browser speech synthesis) |
| Chat kept the spoken words in the input after sending | the input is **cleared** when a voice message is sent |
| AI used tables and cut off mid-answer | the prompt now **forbids tables** and asks for a complete ~120–200-word answer; `max_tokens` raised to 1400; and any table that slips through is **rendered as bullet lines** |
| Sell Advisor's saved-crop line was unreadable | the crop name sits on its own line and the figures are in **two labelled boxes** |
| Crop form showed mm/dd/yyyy and pre-filled the harvest date | dates are now **dd/mm/yyyy** (typed, with a calendar button that opens the native picker); the harvest date is **only estimated when you save with it blank** |
| Settings: rows blended together, both said "Edit", no appearance options | rows are **separated cards**; language says **Change language**; appearance is a **Light / System / Dark** control, with **System** the default (follows the device) |
| ", West Bengal" with a leading comma | the location line joins only the parts that exist |
| "No data found" for a district with no trade | prices now **widen automatically: district → state → all India**, and a banner explains *"Showing prices for West Bengal — we could not find prices for Kolkata"* |

## Notes

- The mandi `/prices` and `/sell-advice` responses now include `scope`
  (`district` / `state` / `india`) and `requested`, which is what drives the
  banner.
- Date fields keep ISO (`YYYY-MM-DD`) in storage so the crop-cycle maths is
  unchanged; only the input format is dd/mm/yyyy.

---

# v18 — round-3 fixes

| Report | Fix |
|---|---|
| Home: the crop name collapsed to one letter per line ("P o t a t o") on a narrow phone | the name keeps a **45% minimum width** and `overflow-wrap: break-word` (not `anywhere`, which broke mid-word); the **stage badge wraps inside its own half** instead of pushing the name out |
| Home: "Edit crop" and "Get my sell advice" wrapped onto two lines on a normal phone | the two buttons now **share the row** (`flex: 1 1 0`) and shrink instead of wrapping |
| Home: the weather card sat *under* the "Live mandi prices" heading | the weather card **moved above** the heading — it is not a mandi price |
| Home: the weather card had no "Today" and no place name | it shows the **place name** (profile district/state, else the last search) and a **Today** pill; the body is full-width with a two-up facts row (no dead space on the right) |
| Weather page only loaded after searching there | the Weather page now **auto-loads from the farm profile's location**, then the last searched place |
| Mandi: the "Wider search" notice broke into one word per line, and claimed "could not find prices for West Bengal" when the farmer had only picked a state | the title is a `<span>` (it was a `display:flex` `<strong>` that blockified mid-sentence), and the notice now shows **only when we actually widened** — searching exactly the requested area is not a "wider search" |
| Crop Doctor: "Fig (Anjeer) None High" was meaningless | the keywords are now **labelled**: Crop · Severity · Confidence (and Status when saved) |
| Crop Doctor: "Read aloud" read every heading and keyword | it now asks the AI for a **2–4 sentence spoken summary** (`/api/summarise`) and reads only that; "N/A" sections are hidden |
| The read-aloud button didn't show it could be stopped | the button turns **solid green and its label becomes "Stop"** while speaking, then returns to "Read aloud" |
| Weather: the "now" card wasn't centred and lacked the tinted styling of the day sheet | it now uses the **same hero + 3-column stat grid** as the day-detail sheet |
| Weather: the 7-day grid left an empty cell when the count was odd | an **odd last day spans the full row** (and hides its secondary meta line) |
| Sell Advisor: bullets didn't line up when the text wrapped | list items are now a flex row with the text in a `<span>`, so **wrapped lines align with the text**, not the dot |
| Sell Advisor: "Your numbers" was cramped | rebuilt as a **readable key/value list**; the best-market price and market are on separate lines |
| Sell Advisor: no read aloud | added, with the same **AI summary** behaviour |

## Notes
- New endpoint: `POST /api/summarise { text, lang } → { summary }` (Groq, 240
  tokens, "2–4 spoken sentences, no headings or bullets"). The read-aloud
  buttons fall back to reading the visible text if the call fails.
- All 237 interface strings now exist in all 23 languages.

---

# v19 — home dashboard layout

| Report | Fix |
|---|---|
| The card buttons stretched across the whole row | `.crop-foot .btn` is `flex: 1 1 auto` with **`max-width: 210px`** — they grow to a fixed range, then stop. They stay on one row down to 320px (font steps down below 400px) |
| "Vegetative growth" wrapped onto a second line | v17 had `white-space: nowrap` on the stage badge; v18 changed it to `normal`. It is **nowrap again** with a smaller size (0.68rem, 0.62rem under 400px), and the name keeps a 40% minimum width with a wrap fallback |
| Cycle-timeline stage names wrapped on narrow cards | the timeline shows **short stage words** (Sow · Growing · Flower · Ripe · Harvest) when the card is narrow. The switch uses a **container query** on the card itself, so it is right at any viewport — a 431px card on a laptop gets short labels just like a phone |
| Dashboard cards stretched the full page width | the home page is now built from **`.home-row` / `.home-col`** — two columns above 760px, stacked below. Each component is at most ~half the content width (~550px at 1440px) |
| Multiple crops each stretched across the page | `.crop-grid` puts crop cards **side by side** (2 columns above 760px) |
| Only "Crop cycle" and "Live mandi prices" had headings | **every** home block now has a `.section-title`: Crop cycle · Weather at your place · Live mandi prices · Quick actions · Today's advisory. The place name and the Today pill moved into the Weather heading's aside; the crop selector moved into the Mandi heading's aside; the duplicate card heads were removed |

## Notes
- `--content-max` (1180px) still caps the whole app; `.page-home` works inside it.
- The container query degrades gracefully: browsers without `@container` fall
  back to a `max-width: 660px` media query, and worst case the label wraps as
  it did before.
- All 242 interface strings exist in all 23 languages.

---

# v20 — sizes, headings and rain

| Report | Fix |
|---|---|
| The stage badge text was too small | the v19 `font-size: 0.68rem` override is gone — the badge is back to the **standard `.badge` size (0.74rem)**, and it still never wraps (`white-space: nowrap`) |
| The card buttons should match the buttons on other pages | the custom `font-size: 0.82rem` / padding override is gone — they are plain **`.btn-sm`**, the same size as every other small button in the app. They still grow only up to `max-width: 230px`, and on phones the **side padding is trimmed** so both stay on one row at full size (no label has to wrap) |
| The card headings were removed | **restored.** Every block now has BOTH: a section heading (`.section-title`) and the card's own heading (`.dash-head` / `<h2>`), exactly as before |
| The weather section heading held the location and "Today" | moved **inside the card**: the section says only "Weather at your place", and the card head shows the place name + the **Today** pill |
| The Mandi card lost its heading | restored — the section says "Live mandi prices" and the card head says "Live mandi prices" with the crop selector, as it was previously |
| Rain was missing from the main weather cards but present in the 7-day forecast | added. The **home weather card** now shows Humidity · Wind · **Rain** (mm + % chance) in three boxes, and the **Weather page "now" card** shows Humidity · Wind · Rain · High/Low in a 2×2 grid on phones and one row on wider screens. The day-detail sheet keeps its own Rain / Wind gusts / High-Low |
| — | also translated two words that were hard-coded English in the day sheet: "chance" and "low" |

All 244 interface strings exist in all 23 languages.

---

# v21 — home dashboard structure audit

| Report | Fix |
|---|---|
| Button style | back to the **v18 style** — equal widths sharing the row (`flex: 1 1 0`, `.82rem`, tighter padding). Safe now that they are capped at `max-width: 230px`, so they never stretch across a wide card |
| The corner pills differed in size | the **"Today" pill and the stage badge are now identical**: 0.74rem, same padding, same radius |
| Cards had different padding | the v19 override (`1rem 1.05rem` on three cards) is gone. **Every card on the page now uses `.card`'s padding** — 24px on desktop, 16.8px on phones |
| The card head and its body had no space between them | the three dashboard cards are `.card` elements, which are plain blocks — so the head and body were flush. They now get **`display: flex; flex-direction: column; gap: 0.75rem`**, the column layout the old `.dash-card` used to provide |
| The "OK" weather flag stretched into a full-width bar | it used `justify-self` (a **grid** property) inside a flex column, so it was ignored. Now `align-self: flex-start` — a **compact pill** |
| Quick-action tiles were unevenly spaced | they were in an `auto-fit` grid that produced **3 tiles + 1 with a hole**. Now a fixed **2 × 2 grid** (1 column under 380px) |
| Mandi section and card had the same title | the **section** now reads **"Mandi price details"**; the card head keeps "Live mandi prices" with the crop selector |
| Quick actions section and card had the same title | the card head now reads **"Shortcuts"**; the section stays "Quick actions" |

A structural sweep now runs at 1440 / 1180 / 900 / 768 / 600 / 390 / 360 / 320px checking for
horizontal overflow, mixed card padding, missing card gaps, uneven tile widths,
incomplete tile rows and mismatched pill sizes — **clean at every width**.

All 246 interface strings exist in all 23 languages.

---

# v22 — final home-page polish

| Report | Fix |
|---|---|
| The card buttons should fill the card | the `max-width: 230px` cap is gone. The dashboard cards sit in fixed columns now, so the two buttons simply **share the row and fill it** (`flex: 1 1 0`) |
| "Today's advisory" appeared twice at the same size | two separate faults: the card's `<h2>` was rendering at `.card h2`'s size (**17.28px**) instead of the card-head size (**15.68px**), and it repeated the section title. The card heading now uses the `.dash-head` style and reads **"What to do today"**, so the pair is section "Today's advisory" / card "What to do today" |
| An abnormal gap before the "Mandi price details" title | a leftover `.dash-weather { margin-bottom: var(--sp-4) }` — added back in v18 when the weather card was a standalone full-width block — was still adding **16px** below the card. Removed; **all five section titles now sit at an identical 24px gap** |

Measured: section titles 17.6px, card headings 15.68px (all five), section gaps
24px (all five), card padding uniform, and the structural sweep clean at
1440 / 1180 / 900 / 768 / 600 / 390 / 360 / 320px.

All 247 interface strings exist in all 23 languages.

### v22 follow-up (same version)

| Report | Fix |
|---|---|
| The "What to do today" card had a different heading→body gap from the other cards | `#home-advisory` was a plain block card while the other three were flex columns. It now uses the **same flex column + 0.75rem gap**, so all four cards measure an identical 12px heading→body gap |
| "Wheat · Sowing" was unclear and "Today" was redundant | the item heading is now **"<crop> — <stage> stage"** (e.g. "Potato — Vegetative growth stage"), which says what the stage is; the "Today" line is gone because the card is already titled "What to do today". Weather-alert items keep their date, since a future date is real information |
| — | the five stage-advice sentences were still **hard-coded English**. They are now translated (`advice_sowing` … `advice_harvest`), plus `crop_stage_label`. All 253 strings exist in all 23 languages |

### v22.1

| Report | Fix |
|---|---|
| Crop Doctor: the keyword value became a huge rounded blob when the text wrapped | a full pill (`--r-full`) only looks right on one short line. The keyword values now use a **rounded rectangle** (`--r-sm`), so a wrapped value reads as a chip rather than a blob. The **Crop** box also takes the full width now (severity and confidence share the row underneath), so a long name like "Soybean (Glycine max) seedling" fits on one line. The "saved" badge moved up beside the diagnosis name, so the row is always exactly three boxes |
| Weather: the first forecast card was permanently lit like a hover state | the `.weather-day.today` border + glow is removed — **all seven cards look identical**; only hover lifts a card |
| Weather: the last forecast card stretched to the full width | replaced the 2-column grid with a **single row of equal cards** (`flex: 1 0 138px`, `overflow-x: auto`, scroll-snap). They grow to fill the row on desktop (no scroll, no empty cell) and scroll sideways on a phone — **no card is ever stretched and no cell is ever empty** |
| Home: the "What to do today" card used the same shield icon as its section heading | the section keeps the shield; the card now uses a **checklist icon** (Lucide `ListChecks`) |

### v22.2

| Report | Finding / fix |
|---|---|
| Weather: the same condition showed different icons/colours | **A real bug.** `current` in the weather service never carried a `weather_code` — so the "now" card rendered `current`'s **text** ("Mostly clear") with **day 0's icon** (a grey cloud). The code now travels with the description and the now-card uses it. The seven forecast cards were already consistent (same description ⇒ same icon ⇒ same colour) — verified by grouping every card by description |
| Crop Doctor: forcing the keyword box full width was the wrong fix | the keyword boxes now **flow like tags** (`flex-wrap` + `flex: 1 1 auto`). Each sizes to its own text; several share a line when they fit; whichever boxes land on a line **share that line's width**, so a row is never left half empty. A long crop name simply takes a line of its own |
| Weather: horizontal scrolling was worse than before | reverted to the **grid** (2 columns on phones, 4 from 700px, all 7 from 1080px) |
| Weather: the last card stretched across the row | a lone last card is now **centred at exactly one column's width** (`grid-column: 1/-1; justify-self: center; width: calc((100% - gap)/2)`) |
| Weather: hover border was cut off | that was the scroll container clipping it (`overflow-x: auto`). With the grid back, the container's overflow is `visible` again, so the border and shadow render fully |

Measured: forecast cards equal width at every breakpoint, container `overflow-x: visible`,
no scrolling, the lone last card centred and one column wide; keyword rows fill
their line (327/327px) for both a short ("Papaya" — all three on one row) and a
long ("Soybean (Glycine max) seedling" — crop on its own row) value.

### v22.3

| Report | Finding / fix |
|---|---|
| Weather: the place suggestions dropped behind the weather card | **Root cause found.** `@keyframes riseIn`/`popIn` ended at `transform: none`, and `animation-fill-mode: both` kept that final keyframe applied **for ever**. A browser resolves `transform: none` inside a finished animation to an **identity matrix** — and an identity transform still creates a **stacking context**. So every `.page > *` became a stacking context, and the later results card painted over the earlier search card's dropdown no matter what z-index the dropdown had (verified: even `z-index: 9999 !important` had no effect). Since the "to" keyframe is identical to the element's natural state, `fill-mode: backwards` is all that is needed — **same animation, no lingering transform**. The search card also gets an explicit `z-index: 2` as a guarantee |
| Weather: suggestions came from all over the world | `searchPlaces` now asks Open-Meteo for 3× the results and **prefers Indian matches**: if any Indian place matches, only those are returned. If none do, the global matches are returned instead — so a search never comes back empty. One request, no extra latency, no new failure mode |

### v22.4

| Report | Finding / fix |
|---|---|
| Weather: re-searching the same place showed a "cached" badge | **The cache was the wrong way round.** `getWeather` was *cache-first*: if a copy existed from the last 30 minutes it was returned and labelled `cached` **without ever trying the network** — so tapping Search again to see "has anything changed?" could never show anything new. It also meant the saved copy was **not** used when the network actually failed (the request threw and the card showed an error). Now it is **live-first**: the service is called on every search, the result is saved, and the saved copy is returned **only** when the service cannot be reached — with a clear label |
| The label read "cached" | the badge was also a hard-coded English string. It is now `weather_saved` — **"Saved forecast"** — shown only in the genuine fallback case, and translated into all 23 languages |

Verified end to end: three searches of the same place each hit the service (no badge); an
upstream temperature change is picked up on re-search (26° → 31°); with the service
returning 503 the card shows the last saved data **with** the "Saved forecast" badge; once
the service recovers the badge clears and the live value returns (24°).

### v22.5

| Report | Finding / fix |
|---|---|
| Two identical forecast requests on a cold load | On boot `applyLanguage()` renders the view, then the Firebase callback renders it again — so `wireWeather` auto-loads twice. The two loads start *before* either finishes, so a value cache cannot help; the requests are now **de-duplicated in flight** (a second call for the same place shares the first request's promise). A short in-memory reuse window also covers the case where the second render lands after the first resolves. Both guards are **in-memory only** — nothing is persisted and neither is ever reported as `cached` |

Verified: the boot now makes **one** forecast request instead of two, while every
behaviour is unchanged — each explicit search still adds exactly one live request, an
upstream change is still picked up on re-search, and the 503 fallback still shows the
saved copy with its "Saved forecast" badge.

### v22.6 — Quick actions as app tiles

The Shortcuts card is now a launcher of app-style tiles instead of four list rows, and it
carries **all six** features rather than only the four that were already in the bottom bar:
Crop Doctor · Ask AI · Weather · Sell Advisor · My Farm · Schemes.

Each shortcut is a squircle tile (70px, 21px radius) with a gradient of its own, the
feature's existing icon centred in white with a soft gloss and drop shadow, and the label
beneath — the way an app launcher reads. The gradients mean something rather than just
differing: emerald for Crop Doctor (plant health), violet for Ask AI, sky for Weather, amber
for Sell Advisor (market and money), teal for My Farm (fields), rose for Schemes.

**Responsive behaviour.** The grid follows the **card's** width via a container query, not the
window's, so the card looks right in every context it appears in:

| Card width | Layout |
|---|---|
| under 340px | 3 × 2, smaller tiles (60px) |
| 340–415px (phones, tablets, narrow desktops) | 3 × 2, 70px tiles |
| 415px and up (1280/1440/1920 desktops, phone landscape) | **all six in one row**, tiles scaling 58–70px with the card |

The tiles use `cqw` units so they shrink just enough to keep all six on one line without
ever overflowing — the card reads the same at 1280 as at 1920. Verified at ten widths from
320px to 1440px: six tiles always, six distinct gradients, no overflow, no clipped labels,
correct order and links.

### v22.7 — resilience against Open-Meteo hiccups

**Why the terminal showed `[error] Open-Meteo failed (503)` and `aborted due to timeout`.**
Those come from the server's global error handler logging a failed call to **Open-Meteo** — the
free third-party weather service — not from a fault in KrishiSathi. `503` is Open-Meteo's own
"service unavailable" answer; the timeout line is our 10-second abort firing on a request it
never answered.

It became *visible* in v22.4: before that, a repeat search within 30 minutes was served from
the 30-minute cache and made no request at all, so an upstream hiccup could never surface.
Once weather went live-first (as asked), every search reaches Open-Meteo, so its bad moments
now show up. That is the honest trade-off of live data — but the app should absorb those
hiccups, so it now does:

| Change | Effect |
|---|---|
| **Retry with backoff** on every Open-Meteo call (2 retries at 0.4s and 1.2s) | a 503 or a timeout is retried instead of failing. A 4xx (other than 408/429) is **not** retried, since the request itself is wrong |
| Upstream failures answered as a **clean 503** with a friendly message, and logged as `[warn]` | the terminal no longer shows an alarming `[error]` for something outside our control, and the client falls back to the saved forecast |
| A failed *lookup* is no longer confused with a *missing place* | the geocoder being unreachable gives 503 "try again"; an unknown name still gives 404 "could not find that place" |
| **3-minute cache for place suggestions** | the autocomplete fires on every keystroke; repeated queries no longer hit Open-Meteo each time |

Verified with a stubbed Open-Meteo: `503, 503, 200` succeeds; `timeout, timeout, 200` succeeds;
always-503 gives up after 3 attempts keeping its message; a 400 is not retried; the geocoder
retries; suggestions are served from cache on the second call. Route behaviour verified for
all four cases (service down → 503 + warning, geocoder down → 503 + warning, unknown place →
404, healthy → 200 with 7 days).

### v22.8

**1. Weather page: "today" shown twice with different conditions — investigated, and it is not a
data bug.** The main card shows the conditions *at this moment* (`current` in the Open-Meteo
response); the first row of the 7-day list shows *the whole of today* (`daily[0]`). Open-Meteo
reports today's `daily.weather_code` as the day's **most significant** code, so a day can read
"Light drizzle" while it is "Overcast" right now.

Checked against a live response for Kolkata — `current` was 28.5°C / code 3 (Overcast) while
`daily[0]` was code 51 (Light drizzle), max 32.7 min 25.6, 0.2mm, 16%. Every *number* already
agreed between the two views (the high/low and the rain in the hero are today's daily values);
only the **condition** differed, because they are two different measures.

The fix is presentational, so nothing is lost and the confusion goes:

| | Before | After |
|---|---|---|
| Hero | "29° Partly cloudy" | "29° **NOW** Overcast" |
| First forecast row | "SUN, 18 OCT" | "**TODAY**" (the day's summary; the detail sheet still shows the full date) |

**2. Overlays had no closing animation.** Every overlay animated *in* via CSS, but closing was an
instant `classList.add('hidden')` — so it vanished with a pop. New `js/motion.js` adds
`showAnimated`/`hideAnimated`: the exit animation plays, and the element is hidden when that
animation actually ends. Applied to the bottom sheet, its backdrop, the login modal (backdrop
fades, panel scales away) and the account menu. A generation guard means re-opening during the
exit animation cancels the pending hide, and `prefers-reduced-motion` skips straight to hidden.

Verified: the sheet reports `sheetDown` mid-close with opacity falling (0.74 at 90ms) and is
hidden after; the backdrop runs `fadeOut`; the modal runs `fadeOut` + `popOut`; re-opening
mid-close works cleanly. All 255 strings exist in all 23 languages.

---

# v23.0 — searchable crop picker

The crop field was a `<select>` over a hand-written list of 34 crops, so most of what
AGMARKNET actually tracks could not be chosen at all.

**The list.** `public/js/crops.js` now carries the **official AGMARKNET commodity master —
604 commodities across the 16 government groups** (Cereals, Pulses, Oil Seeds, Vegetables,
Fruits, Spices, Flowers, Dry Fruits, Fibre Crops, Beverages, Medicinal and Aromatic Plants,
Drug and Narcotics, Forest Products, Live Stock/Poultry/Fisheries, Oils and Fats, Others).
It is taken from the AGMARKNET (Directorate of Marketing & Inspection) commodity lookup
tables — the same names the government price API uses — and bundled so search is instant
and works offline. The 36 everyday crops are kept at the top of the list.

**The picker.** `public/js/combobox.js` renders a text box with a suggestion list
underneath: typing filters, each suggestion shows the crop and its official group, arrow
keys move, Enter picks, Escape closes. Opening a filled field shows the **whole** list with
the current value highlighted, so changing your mind is one click.

The important design choice: the element the app talks to keeps the **same id and the same
`.value`** as the old `<select>`, so every existing `document.getElementById('m-commodity').value`
read/write kept working untouched. Used by the Mandi page and the My Farm crop form.

Verified: 604 crops and 16 groups in both pickers; the farmer's own crop prefills; searching
"turmeric" finds 4 matches; picking sets the value, closes the list, and the chosen crop
reaches the API (`commodity=Turmeric`); keyboard and Escape work; and the whole existing
suite still passes.

### v23.1

| Report | Fix |
|---|---|
| The "Crop Doctor" label in the bottom bar had the top of the "D" clipped | The raised centre button carries a **4px ring** (`box-shadow: 0 0 0 4px var(--surface)`) that separates it from the bar. That ring reaches 4px *below* the icon's box, and the tab's flex gap was only 2px — so the ring landed on the top of the label and shaved the tops of the tall letters (the flat-topped "D" made it obvious). The centre tab's gap is now 8px, which clears the ring by 4px. The bar is bottom-anchored, so **the label does not move on screen** and still lines up with the other four; the tab simply grows into the spare height (the bar is ~65px against a 74px reserve). Measured at 320/360/390/430px: no clipping, 4px clearance |

---

# v24.0 — the marketplace (Phase 1)

The missing half of sowing-to-selling: a two-sided board where a farmer and a buyer
reach each other directly.

**Two kinds of listing.** A farmer posts **Want to Sell** (what they have, how much,
what they want for it); a buyer posts **Want to Buy**. Both are public — anyone can
browse. One account holds **one role**, and the role decides which kind you can create.
On a buyer's post a farmer sees a **Sell** button; on a farmer's post a buyer sees **Buy**.

**The surface is harvest gold.** The market runs on its own background, hue-shifted from
the app's green at the same lightness (`#f8f5f0` against `#f1f6f2`), so it tints rather
than shouts. The farmer's post card is golden, the buyer's is green, and the two badges
(Want to Sell in green, Want to Buy in indigo) are what tell the sides apart. Dark mode
needed a slight lightness lift for the hue to exist at all.

**Each listing** carries the crop, quantity and unit, price, place, and the days left —
which turn amber inside three days and read "Expired" once the window closes. The card
has three actions in one row: the gold Sell/Buy, a green Call, and a white WhatsApp.
Tapping the card opens the full detail with the same two contact links.

**Managing a listing.** My listings shows Extend, Close and Delete; an expired listing
promotes Extend to the primary action so it is one tap from coming back. A listing is
never deleted when its window closes — it simply reads as expired.

**Posting needs an account** — the buyer has to be able to reach you, so the button reads
"Login" and opens the login modal when signed out. The form reuses the searchable crop
picker, prefills the place from the profile, takes a phone number (required) and an
optional email, and asks how many days the listing should run.

**Data.** `market.js` mirrors `store.js`: localStorage on the device, mirrored to a
`marketPosts` collection once signed in, so listings follow the account across devices.
Cleared on logout with the rest of the device data.

**Phase 2 (not yet built):** the structured interest — a farmer attaching crop photos to
a response, and the buyer being notified. Today the Sell/Buy button opens the listing and
contact is direct by call or WhatsApp.

Verified: role-aware feed, title and copy; the golden/green surfaces; posting gated on
sign-in; the 15-day window, extend, close, delete and expiry; the detail sheet's `tel:`
and pre-filled `wa.me` links; no horizontal overflow at 320 or 1440px; and the whole
existing suite still passes.

### v24.1 — market corrections

| Report | Cause and fix |
|---|---|
| The page background was still the app's green, not the golden surface | The golden tokens were set on `.page-market`, but the page is painted by **`body`**, which sits outside that element — so only the page's own subtree was tinted and the visible background never changed. The tokens are now set on `body:has(.page-market)` and `.app-body:has(.page-market)` too |
| The Post button had a heavy border unlike every other button | It is a `<button>`, and no rule reset the element's **browser default border**. `.mk-post-btn` now sets `border: 1.5px solid transparent`, like `.btn` does |
| The form's "Post my listing" button rendered grey | The form lives in a **bottom sheet, which is outside `.page-market`**, so the role-scoped `.mk-seller .mk-submit` / `.mk-buyer .mk-submit` rules never matched and it fell back to the browser default. `.mk-submit` is now the app's standard green primary button, self-contained |
| A visitor saw a farmer-flavoured page and a bare "Login" | A visitor is not a farmer — farmers have their own account and are signed in — so **an unsigned visitor now gets the buyer view**: the buyer badge, "Buy directly", and a post card reading **"Want to buy something?" / "Log in and farmers will call you"** with a full-width **"Login as buyer"** button that records the buyer role before opening the login modal. They can still browse every listing |

### v24.2 — the market actually works

**Why a listing never appeared.** Two separate faults, both silent:

1. **`firestore.rules` denied the board.** The rules ended with "everything else is private
   (deny all)", so every read and write to `marketPosts` was refused. The market is a *public*
   board, so it now has its own block: `read` for everyone (a farmer must be able to find a
   buyer without an account), `create` only when the author id matches the signed-in uid, and
   `update`/`delete` only by the author.
2. **`addDoc` was being handed an `undefined` value.** Firestore rejects any `undefined` field
   and throws — `addPost` spread the whole post in, including `id: undefined`, so *every* save
   failed. Writes now go through a `clean()` helper that drops undefined/null fields.

Both were hidden by an empty `catch`. Failures are now logged, and a listing that could not
reach the board says so: **"Saved on this device — could not reach the board."**

**Login as a buyer now means something.** The market's button asks app.js to open the login
modal *in a role's name* (via a `ks:login` event), so the modal title, hint and submit button
all read as a buyer. The role is applied **after** the profile is hydrated from Firestore,
which is why a new sign-up used to revert to farmer.

**Everything else on the page** is role-aware: a visitor gets the buyer view, a signed-in
farmer the seller view, and the copy follows.

**Spacing.** The chips, the search and the listing list had no gap at all — `#mk-body` had no
layout of its own, so its children stacked flush. It is now a grid with an 0.85rem gap.

**Photos.** A listing takes an optional photo. The browser shrinks it, `POST /api/market/image`
stores it in Cloudinary (`krishisathi/market`, via the uploader now shared with the crop
doctor) and only the URL is kept. The card shows it as a social-post header, and tapping the
photo opens the details. With storage unconfigured the field says so and the listing still
posts.

**CTA.** One row — icon, copy, button. Copy: *"Want to buy something?" / "Log in as a buyer to
start buying and post what you need" / [Login as buyer]*, mirrored for a seller.

### v24.3 — market polish, naming and the buyer's own shell

**Filters.** "Want to Sell / My Listings" was doing two jobs badly. The board now has
four filters in classifieds language — **All · For Sale · Wanted · My Listings**, with
**All** selected by default. A card badge still reads Want to Sell / Want to Buy, which is
the right register for a listing; the chips are the right register for a filter.

**The CTA card.** Heading on ONE line, sub-text free to wrap, all in one row — and
"buyers will call you" became **"buyers will contact you"**, which is the professional
wording. Getting the heading onto one line meant measuring: the login button ("Login as
buyer") was 129px wide and squeezed the heading to 75px at 320px. Dropping the button's
redundant icon and tightening its type brought it to 104px, so the heading now holds one
line from **360px up** in both the visitor and signed-in states. At 320px the visitor
heading still wraps — that width cannot hold the icon, a 155px heading and the button.

**Borders.** The warm surface had tinted every hairline gold, which read as muddy on
ordinary cards and worse in dark mode. Only the CTA card keeps a coloured edge now; all
other hairlines are neutral warm greys (`#e8e2d8` light, `#332c20` dark).

**The bottom bar is aligned again.** The raised centre button's ring needs a 6px gap, and
that extra depth was pushing the centre label **5px below** the other four. Shrinking the
icon's negative margin from -20px to -28px restores the tab's original depth, so all five
labels sit on the same baseline (measured spread: 0px) with the ring still 2px clear.

**The buyer's section is its own shell.** The farmer tab bar is hidden there — a buyer has
no use for Mandi Prices or Crop Doctor — and a floating home button sits bottom-left. A
signed-in farmer keeps the bar.

**Naming follows the role.** The More entry is **Direct Selling** for a signed-in farmer
and **Direct Buying** for a buyer or visitor.

**Shortcuts.** Crop Doctor is out; **Direct Selling** is in, with a handshake icon on a
harvest-gold tile (brighter and yellower than the Sell Advisor's amber so the two do not
read as the same thing).

### v24.4 — nine fixes to the market

**1 · The toast.** It was a 560px black bar with centred white text. It is now a small
pill that hugs its text, sits on the app's own surface, carries a green tick and reads
left-aligned — the same shape as any well-made app.

**2 · The board was invisible to visitors.** `hydrateMarket()` was called *inside* the
`if (user)` branch, so a signed-out visitor never loaded the listings at all — they saw
only whatever that one device had stored. It now runs whether or not anyone is signed in
(the rules allow public read, which is the whole point of the board).

**3 · The price placeholder.** It was hard-coded to "₹ per quintal". It now follows the
chosen unit — "₹ / tonne" the moment you switch.

**4 · The photo field.** Rebuilt: the picture with a **cross on it** to remove it, and the
upload button moved **below** the picture where you asked for it, reading "Change photo"
once one is set. The old grey "Photo added" bar that stayed clickable is gone, and the
field now follows the market's warm surface instead of the crop doctor's green.

**5 · Photos are compressed harder.** 700 KB rather than 1 MB — still sharp, faster to
upload.

**6 · Desktop gets a panel, not a sheet.** A bottom sheet is right on a phone and wrong on
a 1440px screen, so `openSheet()` now renders into a centred floating panel on wide
screens and the sheet on phones. Every overlay that used it inherits the behaviour.

**7 · Edit.** A listing can be corrected now — Edit sits beside Extend, on the card and in
the detail. The form prefills and saves over the original.

**8 · Extend is three days**, not fifteen.

**9 · Actions are coloured by what they do.** Extend is green (it moves the listing
forward), Edit and Close are neutral, and **Delete is red** — the one destructive action,
coloured as it is everywhere else.

### v24.5 — the search bug, four UI fixes, and the interest loop

**1 · The search reversed everything you typed.** Typing "ABCDEFGH" produced "HGFEDCBA".
Cause: every keystroke rebuilt the whole market body, which recreated the `<input>` — and a
recreated input puts the caret back at position 0, so each new letter was inserted at the
front. Only the **list** is re-rendered now (`rerenderList()`), leaving the field and its
caret alone. Verified with real keystrokes: value "ABCDEFGH", caret at 8.

**2 · The Edit button's label sat off-centre.** `ICONS.pencil` did not exist — the icon Proxy
returned an empty 24px box, which pushed the text sideways. The icon is added (and to the
offline fallback), so the label is centred again.

**3 · The Notes box dragged the form sideways.** A textarea is horizontally resizable by
default, and dragging it widened the page. Now `resize: vertical`, and every field is capped
at 100% width.

**4 · The signed-out card.** It now stacks the way you sketched it: icon and copy on the first
row, and **the login button on a row of its own**. That also gives the heading the full column
width, so "Want to buy something?" stays on one line instead of breaking.

**5 · The interest loop.** Buy and Sell now *notify the author* rather than only opening the
listing:

- Tapping **Buy** on a farmer's listing (or **Sell** on a buyer's) records an interest
  addressed to the listing's author, and confirms it with a toast — "The seller has been
  notified of your interest".
- The author gets a **notification card** at the top of the market page with an unseen count.
  Tapping it lists everyone who responded, with their role, a **Call** and **WhatsApp**
  button, and **Accept**.
- The person who responded gets an **Interests** filter showing the listings they replied to,
  marked *Awaiting reply* or *Accepted*.

Stored in a new `marketInterests` collection (publicly readable so the author can see who
responded; create restricted to the responder, update to the two people involved) with the
usual local mirror. **Re-publish `firestore.rules`** for this to cross devices.

## v24.6 — built on v24.5, as asked

This is the v24.5 code with the reported bugs fixed in place. No shared-component layer,
no rewrite — the same files, the smallest change that fixes each fault.

### The role — the one that mattered

**A login was rewriting the account's role.** `app.js` applied `pendingRole` — the role the
login modal is merely *displayed* as — on **every** auth change:

```js
if (pendingRole) { setRole(pendingRole); pendingRole = null; }   // the bug
```

So a farmer who opened the app signed out, tapped the market's **Login as buyer**, and signed
in with their own farmer account, had `role: 'buyer'` written into their profile and pushed to
Firestore. From then on the account was a buyer everywhere, and it survived logging out
because it lived in the cloud.

A role is now chosen **only when an account is created** (`signupRole`), and cleared on every
plain login and on Google sign-in. Settings → *Using KrishiSathi as* lets you correct an
account that was already changed.

**The two logins are distinct again.** The market's button was asking for a role read from the
*stored farm* — `farmer` by default — so "Login as buyer" opened the **farmer** login. That was
the switch. It now asks for `buyer`, because signed out the market page is the buyer's page.

### The rest

- **The notice no longer vanishes.** `openInterestsSheet()` called `notif.remove()` on itself
  and nothing re-rendered it, so it only came back on a reload. It is derived from state now,
  and only appears when there is at least one response.
- **The filter row is listings only.** All / For Sale / Wanted / My listings. Responses are a
  different kind of thing and moved to the notice and the bell.
- **Your own posts show your actions on every filter.** `mine` was `tab === 'mine'`, so anywhere
  else your own listing offered Buy/Sell, which you cannot do to yourself.
- **The bell sits in the top bar**, in its own slot left of the language selector.
- **The respond button becomes *Sent***, loses the amber highlight, and a second tap says
  *"Notification already sent!"*.
- **"Posted by" shows the name only** — it read `Test 1 · Farmer · seller`, which says it twice.

### The role-aware entry, confirmed intact

The More entry still reads **Direct Selling** for a signed-in farmer and **Direct Buying** for a
buyer or visitor (`navLabel()` with `roleName: true`), the page keeps its golden theme and
golden post card, and the market heading follows the role.

### v24.7 — the login decides the role, and the accept actually saves

**The way you sign in is the role you get.** This is a deliberate change of direction from
v24.6. Previously a login left the stored role alone, which meant anyone who signed in through
the wrong door had to go into Settings to correct it. Now:

- the **Login button in the top bar** is the farmer's way in, and the default role is `farmer`
- the market's **"Login as buyer"** signs you in as a `buyer`

So a mistake corrects itself the next time you sign in through the right door, and Settings is
only there if you want it. A plain page load sets no role at all, so a returning session keeps
whatever it already has.

**The accepted response was never saved.** `acceptInterest()` only wrote to Firestore when the
interest had a `cloudId`:

```js
if (uid() && it && it.cloudId) updateInterest(it.cloudId, { status: 'accepted' })   // the bug
```

But `loadInterests()` returns `{ id: d.id, ...d.data() }` — an interest pulled from Firestore
carries its document id as **`id`** and has **no `cloudId`**. So an accept on a real (cloud)
response wrote nothing. On the next load, `hydrateInterests()` pulled the old `status: 'new'`
copy back over the local one and the accept silently undid itself. That is exactly the reported
symptom: it says Accepted, then a refresh puts it back.

It now writes using `it.cloudId || it.id`, which is the correct document id in both cases.

**The responder is now told.** An accepted response sets a local `responderSeen` flag, and the
bell counts accepted responses of yours that you have not looked at yet — alongside the
responses waiting for you. Opening the responses sheet clears both. Nothing new is stored in
Firestore for this; it is a per-device "have I seen it" mark.

The shipped `firestore.rules` already permit the write: the update rule allows the listing's
author (`toId`) as well as the responder (`fromId`).

### v24.8 — the ten reported issues

**The `cloudId` bug, on four more writes.** v24.7 fixed it for the accept; it turns out
**edit, close, extend and delete** had it too:

```js
if (uid() && p && p.cloudId) deletePost(p.cloudId)     // never ran for a cloud post
```

`loadPosts()` returns `{ id: d.id, ...d.data() }`, so a post pulled from Firestore carries its
document id as **`id`** and has **no `cloudId`**. Every one of those actions wrote nothing, and
the next load put the old copy back — which is why a deleted post reappeared after a reload.
All four now use `p.cloudId || p.id`.

**The bell count went stale.** Nothing repainted the top bar when the market changed, so after
accepting or opening the responses sheet the number stayed. The market now fires a
`ks:refresh-chrome` event and the app repaints the bell.

**The bell's number is centred** — `line-height: 1` with `border-box`, so the digit sits in the
middle of its circle instead of low.

**The whole post card is the tap target**, not just the crop text and the photo. Buttons and
links inside a card are excluded, so tapping Call still only calls.

**A response card is tappable through to the listing it is about.**

**The two notification sections are now unmistakable.** They had the same shape, so nothing told
them apart:
- **Responses to your listings** — a **green** edge, the responder's **name** as the headline,
  their role, and Call / WhatsApp / Accept. It is about a *person*.
- **Your responses** — a **gold** edge, the **crop** as the headline, the quantity and price and
  place, and View listing. It is about a *listing*.
Both headings carry a count.

**A little breathing room inside the new sheets** — the market form and the responses list are
inset the way the language picker is. The older sheets are untouched.

**Deleting a listing removes its responses**, so nothing is left pointing at a post that is gone.

**Notification history is pruned after 7 days.**

**The profile menu closes on an outside click.** It passed `{ once: true }`, so the outside-click
handler fired once and removed itself; after that the menu only closed by tapping the avatar
again.

### v24.9 — notifications you can clear, and a menu that closes

**The bell's number came back after a refresh.** `markInterestsSeen()` only writes locally — and
rightly so, "have I looked at this" is a mark this device makes, not something to store in
Firestore. But `hydrateInterests()` put the **cloud** copy first in the merge and de-duplicated
by id, so the cloud's `seen: false` won and the local `seen: true` was thrown away. The merge now
carries the local flags over (`seen`, `responderSeen`, `dismissed`), so the count stays gone.

**Notifications can be cleared** — a **Clear all** button in the sheet's header, and a small cross
on each card to drop just that one. Both are *dismissals*, not deletions: the record stays in
Firestore, this device just stops showing it. That matters, because an actual delete would come
straight back on the next load — the same trap as the accept and the delete bugs.

**A "My Requests" button**, top right of the market page (in the page header, not the
navigation), with a count. It opens just the **Your responses** half — the listings I responded
to — so that half is reachable without opening the full notification sheet.

**The profile menu now closes every time.** v24.8's outside-click handler removed itself after the
first click, so it only worked once per page load. There is now a single listener registered once,
which looks the menu up by id each time — necessary because the account area is re-rendered.

### v24.10 — the header row, rejecting, and the history

**The buttons moved up to the badge row.** "My Requests" sat beside the `h1`, which squeezed the
description into three short lines. The role badge and the page's own buttons now share one row
(`.mk-toprow`), so the heading and the description get the full width — the description is back to
a single line. The chat icon came off the button too; the label says it.

**The cross on a waiting response means NO.** On a response that is still `new`, the cross is a
decision: it sets the status to `rejected` and the person who responded is told, exactly the way
an accept tells them. On anything else the cross only clears the card from the list.

**The history.** A clock icon beside My Requests opens every response I was part of — accepted,
rejected or still waiting — whether or not I cleared it from the notifications. Each row carries
the date, the outcome and a countdown.

Two clocks, deliberately different:

- **7 days** — how long a response still counts as a *notification*.
- **30 days** — how long the *record* is kept, which is what the history shows. Only after that
  is it let go.

So a response drops out of the notifications after a week but stays in the history for a month,
and each history row shows how long it has left. Every row is tappable through to its listing.

### v24.11 — placement, the icon, and post dates

**The layout.** History and My Requests were both crowded onto the badge row. They are now
where they belong:

- **History** — the icon button, at the **right of the badge row**, level with `FARMER · SELLER`.
- **My Requests** — beside the **heading**, level with "Sell directly".

The description therefore keeps the full width and stays on one line, which was the point.

**The history icon** is the Lucide `rotate-ccw-clock` — a clock face with a return arrow, the one
you sent. It is in the icon set as `historyClock` (and in the offline fallback), so it inherits
`currentColor` and the app's stroke weight like every other icon.

**Tooltips.** Both buttons carry `title` and `aria-label`, so hovering explains them and screen
readers announce them.

**Posts now carry their date**, as a green badge in the card's top row, between the type badge and
the days left — which is exactly where you suggested. It reads **Today**, **Yesterday**, or an
absolute date like **21 Oct, 2026**, the way a feed does. The detail sheet shows the full date as
a "Posted on" row.

Note: `views.js` already had a `dateLabel()` used by the Mandi and Weather pages, which takes a
date *string*. The new one is `postDateLabel()` and takes a timestamp, so the existing one is
untouched.

### v24.12 — the market page on a wide screen

Two faults, both only visible above 1024px.

**The left rail had vanished.** The rule that gives the buyer's section its own shell was never
scoped to phones:

```css
body:has(.page-market.mk-buyer) .tabbar { display: none; }   /* all widths */
```

On a phone that is right — a buyer has no use for the farmer tab bar, and the floating home
button takes its place. But **above 1024px the tab bar IS the left rail**, so the market page was
left with no navigation at all and just that floating home button. It is now inside
`@media (max-width: 1023px)`, and the floating home button is hidden above 1024px where the rail
already has a Home entry.

**The listings stretched instead of forming a grid.** `.mk-list` was a single-column grid, so a
card grew with the viewport — at 1400px a card was the full content width with a very wide image.
It now behaves like the home page's `.crop-grid`: one column on a phone, two from 760px, three
from 1200px. At 1400px a card is ~350px instead of ~1080px.

Measured after the fix:

| width | rail | columns | card width |
|---|---|---|---|
| 1400px | visible, 268px, 10 items | 3 | 351px |
| 1180px | visible, 250px, 10 items | 2 | 432px |
| 390px | hidden (by design) | 1 | 363px |

One ordering trap worth recording: the first attempt at hiding the floating home button put the
`@media (min-width: 1024px)` rule *before* `.mk-home`'s own `display: grid`, so the base rule won.
It has to come after.

### v24.13 — panel columns follow the panel, not the window

**The bug was mine, from v24.12.** The listing grid used viewport media queries:

```css
@media (min-width: 760px)  { .mk-list { grid-template-columns: repeat(2, …); } }
@media (min-width: 1200px) { .mk-list { grid-template-columns: repeat(3, …); } }
```

That is right for a full-width page but wrong inside a panel. On a 1180px screen a **560px** panel
was being handed three columns and looked crushed. The grid now measures its own container:

```css
.mk-list { grid-template-columns: repeat(auto-fill, minmax(min(300px, 100%), 1fr)); }
```

`auto-fill` decides the column count from the width **available to the list**, so one rule is
correct both on the page and inside a panel. `min(300px, 100%)` keeps a single column from
overflowing on a very narrow phone.

**The panels also get more room on a wide screen**, so they can actually hold two or three
columns: `.sheet:has(.sheet-wide)` from 768px, and `.modal-panel:has(.sheet-wide)` from 1024px —
the latter because `openSheet()` swaps the bottom sheet for `#form-panel` above 1024px, so the
panel that widens there is a different element.

Measured:

| viewport | page list | panel | panel columns | card width |
|---|---|---|---|---|
| 390px | 1 col | 390px | 1 | 337px |
| 768px | 2 cols | 720px | 2 | 326px |
| 1180px | 2 cols | 1000px | 3 | 300px |
| 1500px | 3 cols | 1000px | 3 | 300px |

No card is ever narrower than 300px.

### v24.14 — the card action buttons no longer spill out of the card

One line of CSS. `.mk-actions .btn` had `flex: 1 1 0` **with** `min-width: 0`, but `.btn` is
`white-space: nowrap` — so a button could shrink narrower than its own label, and the label then
spilled out of the box instead of the row wrapping. It showed on a narrow card: the page was
giving three columns while the rail had not come on yet (roughly 900–1023px), so each card was
about 300px and "Extend" and "WhatsApp" ran off the edge.

```css
.mk-actions .btn { flex: 1 1 auto; min-width: 5.1rem; max-width: 100%; overflow: hidden; }
```

`flex: 1 1 auto` with a real `min-width` makes the row wrap to a second line instead of crushing
the labels. Measured at 360, 390, 900, 1000, 1023, 1180 and 1500px: no label is clipped, no button
sits outside its card, and no button is narrower than 82px.

- A three-button row (Sell / Call / WhatsApp) stays on one line down to a 333px card.
- A four-button row (Edit / Extend / Close / Delete) wraps to a tidy 2×2 when the card is under
  roughly 420px, and stays on one line above that.

Nothing else was touched.
