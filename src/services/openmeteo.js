/**
 * Open-Meteo weather service.
 * Docs: https://open-meteo.com/en/docs
 *
 * 100% free for non-commercial use, NO API key required.
 * Free limits: 10,000 calls/day, 600/minute — plenty for v1.
 *
 * This module also contains the "climate risk alert" rules:
 * we look at the 7-day forecast and flag heavy rain, heat waves,
 * cold/frost and strong winds — the main weather risks for crops.
 */

// Human-readable names for the WMO weather codes Open-Meteo returns
/**
 * Open-Meteo is a free public service: now and then it answers 503 ("busy") or
 * simply does not answer within the timeout. Those are transient — a couple of
 * quick retries turn them into a normal response instead of an error the farmer
 * would see. A 4xx (other than 408/429) means the request itself is wrong, so
 * that is never retried.
 */
const RETRY_DELAYS_MS = [400, 1200];

async function fetchWithRetry(url, { timeoutMs = 10000, label = 'Open-Meteo' } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (res.ok) return res;
      if (res.status < 500 && res.status !== 408 && res.status !== 429) {
        const e = new Error(`${label} failed (${res.status})`);
        e.noRetry = true;
        throw e;
      }
      lastErr = new Error(`${label} failed (${res.status})`);
    } catch (err) {
      if (err.noRetry) throw err;
      lastErr = err;
    }
    if (attempt < RETRY_DELAYS_MS.length) {
      await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
    }
  }
  throw lastErr;
}

const WEATHER_CODES = {
  0: 'Clear sky',
  1: 'Mostly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Fog',
  48: 'Icy fog',
  51: 'Light drizzle',
  53: 'Drizzle',
  55: 'Heavy drizzle',
  61: 'Light rain',
  63: 'Moderate rain',
  65: 'Heavy rain',
  71: 'Light snow',
  73: 'Snow',
  75: 'Heavy snow',
  80: 'Rain showers',
  81: 'Rain showers',
  82: 'Violent rain showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm with hail',
  99: 'Severe thunderstorm with hail',
};

const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';

// Cache place-name → coordinates so we don't re-query the geocoder
const geoCache = new Map();

/**
 * Look up latitude/longitude for a place name (e.g. "Nashik, India").
 */
async function geocode(placeName) {
  if (geoCache.has(placeName)) return geoCache.get(placeName);

  const url = `${GEOCODE_URL}?name=${encodeURIComponent(placeName)}&count=1&language=en&format=json`;
  const res = await fetchWithRetry(url, { timeoutMs: 10000, label: 'Geocoding' });
  const data = await res.json();
  const hit = data.results && data.results[0];
  if (!hit) return null;

  const coords = {
    latitude: hit.latitude,
    longitude: hit.longitude,
    name: hit.name,
    admin: hit.admin1,
  };
  geoCache.set(placeName, coords);
  return coords;
}

/**
 * Rule-based climate risk alerts from a daily forecast entry.
 * Returns an array like [{ level: 'warning', title: 'Heavy rain expected', advice: '...' }]
 */
function ruleBasedAlerts(day) {
  const alerts = [];
  const mm = day.precipitationSum;

  if (mm >= 64.5) {
    alerts.push({
      level: 'danger',
      title: 'Very heavy rainfall',
      advice: 'Expect flooding risk. Avoid applying fertiliser or pesticide; check field drainage and harvest ready crops before the rain.',
    });
  } else if (mm >= 15.5 && mm < 64.5) {
    alerts.push({
      level: 'warning',
      title: 'Heavy rainfall',
      advice: 'Delay spraying and irrigation. Ensure drains are open; cover harvested produce.',
    });
  }

  if (day.tempMax >= 40) {
    alerts.push({
      level: 'danger',
      title: 'Heat wave',
      advice: 'Irrigate in the early morning or evening. Mulch around plants to keep roots cool. Protect livestock from direct sun.',
    });
  } else if (day.tempMax >= 35) {
    alerts.push({
      level: 'warning',
      title: 'Very hot day',
      advice: 'Water crops early morning or after sunset to reduce evaporation loss.',
    });
  }

  if (day.tempMin <= 5) {
    alerts.push({
      level: 'danger',
      title: 'Frost / cold risk',
      advice: 'Cover sensitive crops at night, irrigate lightly in the evening (moist soil holds heat), and protect seedlings.',
    });
  } else if (day.tempMin <= 10) {
    alerts.push({
      level: 'warning',
      title: 'Cold night',
      advice: 'Keep an eye on cold-sensitive crops like tomato, chilli and brinjal.',
    });
  }

  if (day.windGusts >= 50) {
    alerts.push({
      level: 'warning',
      title: 'Strong winds',
      advice: 'Secure stored grain covers and supports for tall crops (banana, sugarcane, maize). Delay spraying — drift will waste chemical.',
    });
  }

  const code = WEATHER_CODES[day.weatherCode] || 'Mixed conditions';
  if (code.includes('Thunderstorm')) {
    alerts.push({
      level: 'warning',
      title: 'Thunderstorm expected',
      advice: 'Avoid working in open fields; lightning risk. Harvest only if the crop is ready and it is safe.',
    });
  }

  return alerts;
}

/**
 * Fetch a 7-day forecast + alerts for coordinates.
 */
async function getForecast(latitude, longitude) {
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    daily: [
      'temperature_2m_max',
      'temperature_2m_min',
      'precipitation_sum',
      'precipitation_probability_max',
      'wind_gusts_10m_max',
      'weather_code',
    ].join(','),
    current: 'temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m',
    timezone: 'auto',
    forecast_days: '7',
  });

  const res = await fetchWithRetry(`${FORECAST_URL}?${params.toString()}`, { timeoutMs: 10000 });
  const data = await res.json();

  const d = data.daily;
  const days = d.time.map((date, i) => {
    const day = {
      date,
      tempMax: Math.round(d.temperature_2m_max[i]),
      tempMin: Math.round(d.temperature_2m_min[i]),
      precipitationSum: d.precipitation_sum[i],
      rainChance: d.precipitation_probability_max[i],
      windGusts: Math.round(d.wind_gusts_10m_max[i]),
      weatherCode: d.weather_code[i],
      description: WEATHER_CODES[d.weather_code[i]] || 'Mixed conditions',
    };
    day.alerts = ruleBasedAlerts(day);
    return day;
  });

  return {
    location: { latitude, longitude, timezone: data.timezone },
    current: {
      temp: data.current.temperature_2m,
      humidity: data.current.relative_humidity_2m,
      wind: data.current.wind_speed_10m,
      // The code must travel with the description, otherwise the icon and the
      // words can disagree (they used to: text from `current`, icon from day 0).
      weatherCode: data.current.weather_code,
      description: WEATHER_CODES[data.current.weather_code] || 'Mixed conditions',
    },
    days,
  };
}

/**
 * Place autocomplete for the weather search box (Open-Meteo geocoding).
 * Returns up to `count` matches like:
 *   { name, admin, country, latitude, longitude }
 */
const suggestCache = new Map(); // query -> { at, all }
const SUGGEST_TTL_MS = 3 * 60 * 1000;

async function searchPlaces(query, count = 6) {
  const cacheKey = String(query).toLowerCase();
  const hit = suggestCache.get(cacheKey);
  if (hit && Date.now() - hit.at < SUGGEST_TTL_MS) {
    return pickPlaces(hit.all, count);
  }

  // Ask for more than we need so there is something to choose from.
  const want = Math.max(count * 3, 12);
  const url = `${GEOCODE_URL}?name=${encodeURIComponent(query)}&count=${want}&language=en&format=json`;
  const res = await fetchWithRetry(url, { timeoutMs: 8000, label: 'Place search' });
  const data = await res.json();
  const all = (data.results || []).map((r) => ({
    name: r.name,
    admin: r.admin1 || '',
    country: r.country || '',
    countryCode: String(r.country_code || '').toUpperCase(),
    latitude: r.latitude,
    longitude: r.longitude,
  }));
  suggestCache.set(cacheKey, { at: Date.now(), all });
  return pickPlaces(all, count);
}

/**
 * KrishiSathi is built for Indian farmers, so Indian places are preferred.
 * If nothing Indian matches, the global matches are returned instead, so a
 * search never comes back empty.
 */
function pickPlaces(all, count) {
  const indian = all.filter((p) => p.countryCode === 'IN' || p.country === 'India');
  return (indian.length ? indian : all).slice(0, count);
}

module.exports = { geocode, getForecast, ruleBasedAlerts, searchPlaces };
