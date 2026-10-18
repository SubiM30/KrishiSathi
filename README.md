# 🌾 KrishiSathi — Farmer's Companion AI

An AI-powered, multilingual web platform for Indian farmers: crop disease
diagnosis from photos, live government mandi prices, weather risk alerts,
personalised sell/hold/storage advice and an AI assistant — all built on
**100% free tiers**.

---

## ✨ What's inside

| Feature | What it does | Powered by |
|---|---|---|
| **Crop Doctor** | Upload a photo of a sick plant → disease/pest diagnosis + organic & chemical treatment | Groq vision model `qwen/qwen3.8-27b`, photos stored in Cloudinary |
| **Mandi Prices** | Live wholesale prices (₹/quintal) across markets, best-mandi comparison, trend | AGMARKNET via data.gov.in |
| **Sell Advisor** | Enter quantity + your costs → sell now / hold / cold storage / direct buyer advice | AGMARKNET data + Groq `gpt-oss-120b` reasoning |
| **Weather & Alerts** | 7-day forecast + automatic alerts for heavy rain, heat wave, frost, strong winds | Open-Meteo (no key needed) |
| **Govt Schemes** | Simple summaries of PM-KISAN, PMFBY, KCC, e-NAM, etc. with official links | Static curated content |
| **Ask AI** | Chat in Hindi/English/Marathi/Tamil/Telugu/Bengali and more | Groq `gpt-oss-120b` |
| **Accounts** | **Sign up** + login with Email or Google, **Guest mode** (browse everything without an account) | Firebase Auth (free Spark plan) |
| **PWA** | Installable on phones (Add to Home Screen), app shell works offline | Web app manifest + service worker (`sw.js`) |
| **23 languages** | English + all 22 scheduled Indian languages — the whole interface switches instantly, and the AI replies in the same language | `public/js/i18n.js` |
| **Dark mode** | Light / dark theme toggle in the header, remembered per device, works on every page | CSS variables (`[data-theme="dark"]`) |
| **Saved history** | Logged-in users get their diagnoses saved privately | Firebase Firestore (free tier) |

## 🎨 Interface (v14 redesign)

The whole interface was rebuilt around a **bottom navigation bar** (which
becomes a **left side rail** on desktop) with a modern, minimal look:

- **App shell** — app bar · content · footer · navigation, plus a **"More"
  bottom sheet** for secondary features (Weather, Sell Advisor, Schemes, Settings).
- **One nav config** — reorder or rename tabs by editing the `NAV` / `MORE`
  arrays at the top of `public/js/app.js`.
- **Design tokens** — every colour, radius, spacing and motion value lives in
  `public/css/styles.css`; re-skin the app without touching components.
- **Icons** — [Lucide](https://lucide.dev) loaded from a CDN (`public/js/icons.js`).
- **Fonts** — Plus Jakarta Sans, with Mukta for Devanagari.
- **Responsive + animated** — mobile → tablet → desktop, with entrance,
  sheet, modal and micro-interactions (all disabled under `prefers-reduced-motion`).

- **My Farm** — save **multiple crops** (sowing date, area, expected yield)
  and each crop's **production-cost expenses**; the dashboard, prices and
  sell advice are all personalised from this. Data lives in **Firebase
  Firestore** when logged in (localStorage for guests), so nothing is static.
- **Crop-cycle tracker** — a stage bar (sowing → vegetative → flowering →
  maturity → harvest) with days-to-harvest, driven by the crop's sowing date.

- **23 languages, fully translated** — every string in the app (211 keys) now
  exists in all 23 languages; switching language changes the whole UI.
- **Mandi prices fetch live on demand** — pressing "Show prices" bypasses the
  server's 30-minute cache and only falls back to cached figures if the
  government API is unavailable.
- **Crop Doctor history** — past diagnoses (with their Cloudinary photo) are
  kept in Firestore and on the device, and open in full when tapped.
- **Settings** — language, theme and a "reset to default"; logging out clears
  this device's copy of the data.

- **Prices widen automatically** when your district has no trade for a crop:
  district → state → all India, with a banner saying so.
- **Photos are shrunk under 1 MB** before diagnosis, so they upload reliably
  and appear in your diagnosis history; the diagnosis can be read aloud.
- **Appearance** can be Light, Dark or System (the default).

- **Read aloud** on the diagnosis and the sell advice: the AI writes a short
  spoken summary and the browser reads that, not every heading.
- **The Weather page loads from your farm profile** without you searching again.

- **Home dashboard** is laid out in two columns on wider screens, so each
  widget has a sensible maximum width instead of stretching across the page,
  and every block has its own heading.

- **Rain** now appears on the home weather card and the Weather page, not only
  in the 7-day forecast.

- The 7-day forecast is one row of equal cards that scroll sideways on a
  phone, so no day is stretched or left with an empty gap.

> Full details, and how to change any of it, are in **[docs/UI.md](docs/UI.md)**.

## 🧰 Tech stack (and where each piece is used)

- **Frontend**: plain **HTML + CSS + JavaScript** (vanilla, no React) in `public/`
- **Backend**: **Node.js + Express** — this is the *only framework* in the project;
  it lives in `server.js` + `src/`. It serves the frontend files and exposes the
  API routes under `/api/`. All secret API keys stay on this side.
- **Auth + DB**: Firebase (free Spark plan) — email/Google login + Firestore.
  **MongoDB is not needed** — Firestore's free tier covers everything in v1.
- **AI**: Groq API (free tier)
- **Data**: data.gov.in AGMARKNET, Open-Meteo, Cloudinary

> No RAG/embeddings, and no Bhashini voice in v1 — by design (phase 2).

## 📁 Project structure

```
krishisathi/
├── server.js                 ← entry point: Express server
├── package.json              ← npm start
├── .env.example              ← copy to .env, add your keys
├── firestore.rules           ← paste into Firebase console
├── src/
│   ├── routes/               ← one file per API feature
│   │   ├── chat.js           ← POST /api/chat
│   │   ├── diagnose.js       ← POST /api/diagnose (vision)
│   │   ├── mandi.js          ← GET  /api/mandi/prices, POST /api/mandi/sell-advice
│   │   └── weather.js        ← GET  /api/weather/forecast
│   ├── services/             ← the code that talks to outside APIs
│   │   ├── groq.js           ← Groq LLM + vision calls
│   │   ├── agmarknet.js      ← mandi prices (+ 30-min cache)
│   │   └── openmeteo.js      ← weather + alert rules
│   └── middleware/
│       └── rateLimit.js       ← protects the free AI quota
├── docs/UI.md                ← the design system + how to change the UI
└── public/                   ← the whole frontend (vanilla)
    ├── index.html            ← app shell (app bar, nav, sheet, modal)
    ├── css/styles.css        ← the design system (tokens → components)
    └── js/
        ├── app.js            ← router + login modal
        ├── views.js          ← one render function per page
        ├── api.js            ← talks to the backend
        ├── auth.js           ← Firebase login + guest mode + saves
        ├── data.js           ← schemes, crop and state lists
        └── firebase-config.js← YOUR Firebase keys go here
```

---

## 🚀 Setup guide (step by step, all free)

You need [Node.js 18+](https://nodejs.org) installed. Then:

### 1. Run the backend

```bash
cd krishisathi
npm install
cp .env.example .env      # Windows: copy .env.example .env
npm start
```

Open **http://localhost:3000** — the site works right away (weather works
with zero keys; other features need the keys below).

### 2. Get your free keys

**Groq (AI)** — 2 minutes
1. Sign up at https://console.groq.com (no card needed)
2. API Keys → Create API Key → copy it
3. Put it in `.env` as `GROQ_API_KEY=...`

**data.gov.in (mandi prices)** — 5 minutes
1. Sign up at https://data.gov.in
2. Go to your profile / "My account" → you'll find your **API key**
3. Put it in `.env` as `DATA_GOV_IN_API_KEY=...`

**Cloudinary (photo storage)** — 3 minutes
1. Sign up at https://cloudinary.com (free plan, no card)
2. Console → Dashboard: copy **Cloud name**, **API Key**, **API Secret**
3. Add all three to `.env` (`CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`,
   `CLOUDINARY_API_SECRET`)
4. *Optional:* even without Cloudinary, Crop Doctor still works (photos are
   just not saved).

**Open-Meteo (weather)** — nothing to do. No key, no signup. 🎉

### 3. Set up Firebase (login + saved history) — 10 minutes

1. Go to https://console.firebase.google.com → **Add project** (choose the
   free Spark plan — it's automatic, no card).
2. Click the **`</>`** (web) icon → register the app → copy the `firebaseConfig`
   values into `public/js/firebase-config.js`.
3. Console → **Authentication** → Get started → enable **Email/Password**
   and **Google**.
4. Console → **Firestore Database** → Create database → **Start in test
   mode** → enable. Then open the **Rules** tab and paste the contents of
   `firestore.rules` from this project → Publish. (This makes each user's
   data private to them.)
5. Restart `npm start` if it was running.

> **Phone login?** Not in v1 — Firebase phone auth sends SMS messages that are
> billed per SMS and require the paid Blaze plan, so we left it out to stay
> 100% free. Guest mode + email + Google cover everything.

### 4. Mobile app & offline (PWA)

KrishiSathi is a **Progressive Web App**:
- On Android (Chrome): open the site → menu → **"Install app"**
- On iPhone (Safari): Share → **"Add to Home Screen"**
- The interface loads offline; live data (prices/weather/AI) needs internet —
  offline you'll see a friendly offline page.

### 5. Try it

- **Weather** → search "Nashik" or use GPS → see alerts
- **Crop Doctor** → upload any leaf photo → diagnosis
- **Mandi Prices** → Onion in Maharashtra → compare markets
- **Sell Advisor** → enter quantity + cost → advice
- **Ask AI** → type in Hindi: "मेरी गेहूं की फसल में कीट लग गए हैं, क्या करूं?"
- **Guest mode** → click "Login / Guest" → "Continue as Guest"

---

## 🧯 Common problems

| Problem | Fix |
|---|---|
| `GROQ_API_KEY not set` warning | You skipped step 2 — add keys to `.env` and restart (`Ctrl+C`, `npm start`) |
| AI says "too many requests" | Free-tier rate limit — wait a minute. Our limiter: 15 chats/5 min, 8 diagnoses/10 min |
| Mandi search empty | Check the crop spelling matches AGMARKNET (the dropdowns already use official names) |
| Weather "could not find place" | Try a bigger nearby city name |
| Login popup says "operation-not-allowed" | Enable that sign-in method in Firebase Console → Authentication |
| Port already in use | Change `PORT=3001` in `.env` |

## 🔒 Security notes

- Real API keys live **only** in `.env` on the server — never in the frontend.
- Firebase config values in `firebase-config.js` are *meant to be public*
  (this is standard); your data is protected by `firestore.rules`.
- `.env` is listed in `.gitignore` so you won't accidentally commit it.

## 🗺️ Roadmap (phase 2 ideas)

- **Bhashini AI** voice interface (STT/TTS) for 22+ languages — when API access is approved
- **Voice input** using the browser's built-in Web Speech API (works in Chrome, no key)
- Price prediction with historical AGMARKNET data (simple moving averages)
- B2B/B2C buyer–farmer direct connection
- PWA install + offline caching for low-connectivity villages
- SMS/WhatsApp alerts

## ⚖️ Licence & credits

Built with: Groq (AI), AGMARKNET/data.gov.in (prices), Open-Meteo (weather),
Cloudinary (images), Firebase (auth/DB). All marks belong to their owners.
AI advice is guidance only — always confirm with local agriculture officers
(KVK) before major decisions.
