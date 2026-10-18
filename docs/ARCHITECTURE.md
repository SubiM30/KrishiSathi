# KrishiSathi — Architecture & Research Notes

This document records the research behind every technical decision, so
future contributors understand **why** the system looks the way it does.

## 1. Research findings (all verified before building)

### Groq (AI) — free tier
- `openai/gpt-oss-120b`: 30 requests/min, 1,000 requests/day, 8K tokens/min,
  200K tokens/day on the free plan. Prompt caching is automatic on the
  GPT-OSS models — the shared system prompt stops counting against quota,
  which is why we put the long system prompt FIRST in every request.
- `qwen/qwen3.8-27b`: Groq's current vision (image + text) model — used for
  crop disease diagnosis. Supports JSON mode, which we use to get
  structured diagnoses.
- Because the quota is per **organization** (the whole app shares it),
  we added a small in-memory rate limiter per IP on the AI routes.

### AGMARKNET via data.gov.in
- Dataset: "Current Daily Price of Various Commodities from Various
  Markets (Mandi)", resource `9ef84268-d588-465a-a308-a864a43d0070`.
- Free API key from data.gov.in; filters `filters[commodity]`,
  `filters[state.keyword]`, `filters[district]`; JSON output with
  min/max/modal price per market per arrival date.
- Free keys are rate-limited, so every query is cached server-side for
  30 minutes (mandi prices change at most daily).
- Filter and field names occasionally change casing between dataset
  revisions; commodity spellings must match (we normalise common
  Hindi/English names in `agmarknet.js`).

### Open-Meteo
- Free for non-commercial use, no API key, ~10,000 calls/day.
- `daily` variables used: temperature max/min, precipitation sum,
  precipitation probability, wind gusts, WMO weather code.
- Alert thresholds follow IMD conventions: ≥15.5 mm = heavy rain,
  ≥64.5 mm = very heavy rain; heat wave ≥40°C; frost risk ≤5°C;
  strong wind gusts ≥50 km/h.

### Firebase (free Spark plan)
- Email/password + Google login: free.
- Phone login: **not free** (billed per SMS, requires Blaze plan) →
  deliberately excluded in v1.
- Firestore free tier (1 GiB storage, 50K reads / 20K writes per day) is
  far beyond v1 needs → **MongoDB not required**, satisfying the project
  rule "only use MongoDB if needed".

### Cloudinary
- Free plan: 25 credits/month (1 credit ≈ 1 GB storage or 1 GB image
  bandwidth or 1,000 transformations). Signed uploads are implemented
  with Node's built-in `crypto` (SHA-1 signature) — no SDK dependency.
- If Cloudinary isn't configured, diagnosis still works (image passes
  straight through to the vision model and isn't stored).

## 2. Architecture decisions

| Decision | Choice | Why |
|---|---|---|
| Frontend | Vanilla HTML/CSS/JS SPA | Project requirement — first preference vanilla. A hash router (`#/page`) in `app.js` replaces what React Router would do |
| Backend | Node.js + Express (only framework) | Standard, minimal, free. Also serves the static frontend so one command runs everything |
| AI calls | Server-side only | Groq key must never reach the browser |
| Database | Firebase Firestore | Free tier covers v1; MongoDB Atlas would add ops burden with no benefit at this scale |
| Auth | Firebase Auth + custom guest flag | Email/Google free; guest mode is just a localStorage flag — guests get full read access, no saves |
| Data caching | In-memory (server) + localStorage (weather, client) | Protects data.gov.in quota and Open-Meteo budget |
| Sell advice | Deterministic math in code + LLM for wording | Never trust an LLM with arithmetic — profits are computed in JS, the model only explains and recommends |
| Multilingual | Model's native multilingual ability (text) | No Bhashini in v1 per project decision; text chat already works in major Indian languages |

### Request flows

```
Browser (public/)          Express (src/)                 External APIs
─────────────────          ────────────────               ──────────────
Crop Doctor  ──photo──▶  /api/diagnose ──upload───────▶  Cloudinary
                            └──base64/URL──────────────▶  Groq vision (qwen3.8-27b)
                            ◀── structured JSON ───────
Mandi        ──form───▶  /api/mandi/prices ──(cached)─▶  data.gov.in
Sell Advisor ──form───▶  /api/mandi/sell-advice ──┬────▶  data.gov.in (prices)
                                                   └────▶  Groq (recommendation)
Weather      ──place──▶ /api/weather/forecast ──geocode─▶ Open-Meteo
Chat         ──text───▶  /api/chat ─────────────────▶  Groq (gpt-oss-120b)
```

### Data model (Firestore)

```
users/{uid}                      ← auto-created doc area on first save
  diagnoses/{autoId}             { crop, problem, severity, imageUrl, createdAt }
  sellAnalyses/{autoId}          { commodity, quantity, recommendation, headline, createdAt }
```

Rules (`firestore.rules`) allow each signed-in user to read/write **only**
their own subtree; everything else is denied.

## 3. Free-tier budget (what happens at scale)

| Service | Free limit | v1 protection |
|---|---|---|
| Groq gpt-oss-120b | 1,000 req/day, 200K tok/day | Per-IP rate limits (15 chat / 5 min; 8 diagnoses / 10 min); max_tokens caps |
| data.gov.in | ~few requests/min | 30-min server cache; 200-record cap |
| Open-Meteo | 10,000 calls/day | 30-min client cache per place |
| Cloudinary | 25 credits/month | 4 MB photo cap; storage is optional |
| Firestore | 50K reads / 20K writes per day | History capped to last 5-10 docs per user |

## 4. Known limitations of v1

- Groq daily quota is shared app-wide: if the app goes viral, AI features
  will 429 before the day ends (the UI degrades gracefully with a
  "try again later" message).
- Mandi price "prediction" is not implemented (deliberately — phase 2);
  the Sell Advisor uses current prices + trend, and clearly says so.
- The AI diagnosis is advisory; the UI always shows the disclaimer and
  nudges farmers to confirm with a KVK / agriculture officer.
- No voice interface yet (Bhashini planned for phase 2).
- Express is a single process — in-memory caches and rate limits reset
  on restart (fine for v1 scale).

## 5. Phase-2 candidate designs

- **Bhashini voice**: browser records audio → Bhashini ASU (speech-to-text)
  → existing `/api/chat` → Bhashini TTS back to audio. The chat route is
  already language-agnostic, so Bhashini slots in as a front-end layer only.
- **Price prediction**: nightly cron fetching AGMARKNET into Firestore,
  7-day moving average + simple linear trend shown as a chart; no ML
  needed for a useful first version.
- **Buyer marketplace**: new Firestore collections `buyers` and `listings`
  with Cloud Functions for matching — note Cloud Functions needs the
  Blaze plan (has its own free monthly allowance).
