/**
 * Weather routes (Open-Meteo — free, no API key).
 *
 * GET /api/weather/forecast?place=Nashik    (place name → geocode → forecast)
 * GET /api/weather/forecast?lat=20&lon=73.8  (direct coordinates, e.g. from GPS)
 *
 * The response includes 7 daily entries; each already carries the
 * rule-based climate risk alerts computed in services/openmeteo.js.
 */
const express = require('express');
const { geocode, getForecast, searchPlaces } = require('../services/openmeteo');

const router = express.Router();

/** Place autocomplete — powers the suggestions dropdown in the weather search box. */
router.get('/search', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json({ results: [] });
    const results = await searchPlaces(q, 6);
    res.json({ results });
  } catch (err) {
    // suggestions are optional — fail softly so the app still works
    res.json({ results: [] });
  }
});

router.get('/forecast', async (req, res, next) => {
  try {
    let { lat, lon, place } = req.query;
    let placeName = null;

    if (lat && lon) {
      lat = Number(lat);
      lon = Number(lon);
      if (Number.isNaN(lat) || Number.isNaN(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
        return res.status(400).json({ error: 'Invalid coordinates.' });
      }
    } else if (place) {
      // A failure to REACH the geocoder is not the same as "no such place" —
      // say so, so the farmer knows to try again rather than fix their spelling.
      try {
        placeName = await geocode(`${place}, India`);
      } catch (err) {
        console.warn('[warn] geocoding service unavailable:', err.message);
        return res.status(503).json({
          error: 'The place lookup service is not responding right now. Please try again in a moment.',
        });
      }
      const location = placeName;
      if (!location) {
        return res
          .status(404)
          .json({ error: 'Could not find that place. Try a nearby city or district name.' });
      }
      lat = location.latitude;
      lon = location.longitude;
    } else {
      return res.status(400).json({ error: 'Provide a place name or coordinates.' });
    }

    // Open-Meteo returning 503 / timing out is an upstream problem, not a bug in
    // the app: log it as a warning and answer with a clean 503 so the client can
    // fall back to the saved forecast instead of showing a generic error.
    let forecast;
    try {
      forecast = await getForecast(lat, lon);
    } catch (err) {
      console.warn('[warn] weather service unavailable:', err.message);
      return res.status(503).json({
        error: 'The weather service is not responding right now. Please try again in a moment.',
      });
    }

    // Attach a human-readable place name + state so the frontend can
    // remember the location (name for display, state for mandi lookups).
    if (placeName) {
      forecast.location = { ...forecast.location, name: placeName.name, admin: placeName.admin || '' };
    } else {
      // GPS coordinates — reverse-geocode for free (no API key needed)
      let name = 'Your location';
      let admin = '';
      try {
        const r = await fetch(
          `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`,
          { signal: AbortSignal.timeout(6000) }
        );
        if (r.ok) {
          const g = await r.json();
          name = g.city || g.locality || name;
          admin = g.principalSubdivision || '';
        }
      } catch {
        /* naming is optional — coordinates still work */
      }
      forecast.location = { ...forecast.location, name, admin };
    }

    res.json(forecast);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
