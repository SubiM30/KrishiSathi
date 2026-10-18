/**
 * AGMARKNET mandi price service (via data.gov.in).
 * Docs / key: https://data.gov.in (sign up → My Account → API key)
 *
 * Dataset: "Current Daily Price of Various Commodities from Various Markets (Mandi)"
 * Resource id: 9ef84268-d588-465a-a308-a864a43d0070
 *
 * Each record: state, district, market, commodity, variety, grade,
 *              arrival_date, min_price, max_price, modal_price  (₹ / quintal)
 *
 * IMPORTANT: the free data.gov.in key allows only a handful of requests
 * per minute, so every query result is cached in memory for 30 minutes.
 */
const RESOURCE_URL =
  'https://api.data.gov.in/resource/9ef84268-d588-465a-a308-a864a43d0070';

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
// data.gov.in is often briefly down (502) — and it is genuinely SLOW: a
// query over the full AGMARKNET dataset regularly takes 15-25 seconds.
// v12 lowered this to 10s per attempt, which made every request abort
// before the government server could answer. These timeouts restore the
// 25s that worked, plus one shorter retry for the fast-failing 502 case.
const STALE_TTL_MS = 24 * 60 * 60 * 1000;
const ATTEMPT_TIMEOUTS_MS = [25000, 20000]; // attempt 1: 25s, retry: 20s
const BACKOFF_MS = [1500];                  // brief pause before the retry

// Simple in-memory cache: { cacheKey: { at: timestamp, records: [...] } }
const cache = new Map();

/** Common commodity names farmers type vs. official AGMARKNET spellings */
const COMMODITY_ALIASES = {
  onion: 'Onion',
  pyaz: 'Onion',
  potato: 'Potato',
  aloo: 'Potato',
  tomato: 'Tomato',
  tamatar: 'Tomato',
  wheat: 'Wheat',
  gehun: 'Wheat',
  paddy: 'Paddy',
  dhan: 'Paddy',
  rice: 'Paddy',
  cotton: 'Cotton',
  kapas: 'Cotton',
  maize: 'Maize',
  corn: 'Maize',
  makka: 'Maize',
  soybean: 'Soybean',
  soyabean: 'Soybean',
  sugarcane: 'Sugarcane',
  ganna: 'Sugarcane',
  mustard: 'Mustard',
  sarson: 'Mustard',
  gram: 'Gram',
  chana: 'Gram',
  tur: 'Arhar (Tur)',
  arhar: 'Arhar (Tur)',
  'tur dal': 'Arhar (Tur)',
  moong: 'Moong',
  urad: 'Urad',
  groundnut: 'Groundnut',
  peanut: 'Groundnut',
  banana: 'Banana',
  kela: 'Banana',
  apple: 'Apple',
  mango: 'Mango',
  aam: 'Mango',
  grapes: 'Grapes',
  orange: 'Orange',
  'sweet orange': 'Sweet Orange',
  santra: 'Sweet Orange',
  chilli: 'Chilli',
  'chili dry': 'Chilli',
  garlic: 'Garlic',
  'garlic dry': 'Garlic',
  ginger: 'Ginger',
  coriander: 'Coriander',
  bajra: 'Bajra',
  jowar: 'Jowar',
  barley: 'Barley',
  castor: 'Castor Seed',
  linseed: 'Linseed',
  sesame: 'Sesame Seed',
  til: 'Sesame Seed',
  sunflower: 'Sunflower Seed',
  coconut: 'Coconut',
  nariyal: 'Coconut',
};

function normaliseCommodity(input) {
  if (!input) return '';
  const key = input.trim().toLowerCase();
  if (COMMODITY_ALIASES[key]) return COMMODITY_ALIASES[key];
  // Capitalise each word as AGMARKNET mostly uses Title Case
  return input
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Fetch mandi price records with caching.
 * @param {object} filters { commodity, state, district, limit }
 */
async function getMandiPrices({ commodity, state, district, limit = 100, fresh = false }) {
  const officialName = normaliseCommodity(commodity);

  const cacheKey = JSON.stringify({ officialName, state, district, limit });
  const cached = cache.get(cacheKey);
  // `fresh` = the farmer pressed "Show prices", so go to the government API
  // for the latest figures instead of the 30-minute cache. The cache is still
  // written below, and is served if the live fetch fails.
  if (!fresh && cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return { records: cached.records, cached: true };
  }

  if (!process.env.DATA_GOV_IN_API_KEY) {
    const err = new Error('DATA_GOV_IN_API_KEY missing');
    err.status = 503;
    err.publicMessage =
      'Mandi prices are not configured yet. Ask the developer to add the free data.gov.in API key.';
    throw err;
  }

  const params = new URLSearchParams({
    'api-key': process.env.DATA_GOV_IN_API_KEY,
    format: 'json',
    offset: '0',
    limit: String(Math.min(limit, 500)),
  });
  if (officialName) params.append('filters[commodity]', officialName);
  if (state) params.append('filters[state.keyword]', state);
  if (district) params.append('filters[district]', district);

  // data.gov.in is slow and sometimes briefly down — try twice, with a
  // long first wait (25s) so slow-but-working responses get through.
  const url = `${RESOURCE_URL}?${params.toString()}`;
  let lastErr = null;
  for (let attempt = 0; attempt < ATTEMPT_TIMEOUTS_MS.length; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, BACKOFF_MS[attempt - 1]));
    }
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(ATTEMPT_TIMEOUTS_MS[attempt]) });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        const err = new Error(`data.gov.in failed (${res.status}): ${text.slice(0, 120)}`);
        err.status = res.status === 429 ? 429 : 502;
        err.publicMessage =
          res.status === 429
            ? 'The mandi price service is busy right now. Please try again in a minute.'
            : 'The government mandi price service (data.gov.in) is not responding right now. Please try again in a few minutes.';
        throw err;
      }
      const payload = await res.json();
      const records = (payload.records || []).map((r) => ({
        state: r.state,
        district: r.district,
        market: r.market,
        commodity: r.commodity,
        variety: r.variety,
        grade: r.grade,
        arrivalDate: r.arrival_date,
        minPrice: Number(r.min_price) || null,
        maxPrice: Number(r.max_price) || null,
        modalPrice: Number(r.modal_price) || null,
      }));

      cache.set(cacheKey, { at: Date.now(), records });
      return { records, cached: false };
    } catch (e) {
      lastErr = e;
      // network-level failures (timeout, DNS…) — give them a friendly message
      if (!e.publicMessage) {
        e.publicMessage =
          'The mandi price service is very slow right now. Please try again in a few minutes.';
      }
      console.error(`[mandi] attempt ${attempt + 1} failed: ${e.message}`);
    }
  }

  // All attempts failed — serve yesterday's data if we have it
  if (cached && Date.now() - cached.at < STALE_TTL_MS) {
    console.warn('[mandi] serving stale cached data from', new Date(cached.at).toISOString());
    return { records: cached.records, cached: true, stale: true };
  }

  throw lastErr;
}

/**
 * Fetch prices, widening the search if the exact location has nothing:
 *   district → state → all India.
 * Returns { records, cached, stale, scope, requested } where scope says which
 * level actually produced data.
 */
async function getMandiPricesWide({ commodity, state, district, limit = 200, fresh = false }) {
  const attempts = [];
  if (state && district) attempts.push({ state, district, scope: 'district' });
  if (state) attempts.push({ state, district: undefined, scope: 'state' });
  attempts.push({ state: undefined, district: undefined, scope: 'india' });

  let lastErr = null;
  for (const a of attempts) {
    try {
      const r = await getMandiPrices({ commodity, state: a.state, district: a.district, limit, fresh });
      if (r.records && r.records.length) {
        return {
          ...r,
          scope: a.scope,
          requested: { state: state || null, district: district || null },
        };
      }
    } catch (e) {
      lastErr = e;
    }
  }
  if (lastErr) throw lastErr;
  return { records: [], cached: false, stale: false, scope: 'none', requested: { state: state || null, district: district || null } };
}

/**
 * Build a small price summary from raw records:
 * best/worst markets, average modal price, and a simple trend by arrival date.
 */
function summarise(records) {
  if (!records.length) return null;

  const withPrice = records.filter((r) => r.modalPrice);
  if (!withPrice.length) return null;

  // Group markets by their latest modal price
  const byMarket = new Map();
  for (const r of withPrice) {
    const key = `${r.market} (${r.district})`;
    const prev = byMarket.get(key);
    if (!prev || (r.arrivalDate || '') >= (prev.arrivalDate || '')) byMarket.set(key, r);
  }
  const marketList = [...byMarket.entries()]
    .map(([name, r]) => ({
      market: name,
      modalPrice: r.modalPrice,
      minPrice: r.minPrice,
      maxPrice: r.maxPrice,
      arrivalDate: r.arrivalDate,
    }))
    .sort((a, b) => b.modalPrice - a.modalPrice);

  // Simple trend: average modal price per arrival date, oldest → newest
  const byDate = new Map();
  for (const r of withPrice) {
    if (!r.arrivalDate) continue;
    if (!byDate.has(r.arrivalDate)) byDate.set(r.arrivalDate, []);
    byDate.get(r.arrivalDate).push(r.modalPrice);
  }
  const trend = [...byDate.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, prices]) => ({
      date,
      avgPrice: Math.round(prices.reduce((s, p) => s + p, 0) / prices.length),
    }));

  const modalPrices = withPrice.map((r) => r.modalPrice);
  return {
    commodity: withPrice[0].commodity,
    recordCount: records.length,
    avgModalPrice: Math.round(modalPrices.reduce((s, p) => s + p, 0) / modalPrices.length),
    minSeen: Math.min(...modalPrices),
    maxSeen: Math.max(...modalPrices),
    bestMarket: marketList[0],
    worstMarket: marketList[marketList.length - 1],
    markets: marketList.slice(0, 12),
    trend,
    latestDate: trend.length ? trend[trend.length - 1].date : null,
  };
}

module.exports = { getMandiPrices, getMandiPricesWide, summarise, normaliseCommodity };
