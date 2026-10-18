/**
 * Mandi price routes (data.gov.in / AGMARKNET).
 *
 * GET  /api/mandi/prices?commodity=Onion&state=Maharashtra&district=Nashik
 * POST /api/mandi/sell-advice  → personalised sell/hold/storage recommendation
 *        Body: { commodity, state, district, quantityQuintals, totalCost,
 *                storageCostPerDay?, cropName? }
 */
const express = require('express');
const { getMandiPricesWide, summarise } = require('../services/agmarknet');
const { groqChat } = require('../services/groq');
const { rateLimit } = require('../middleware/rateLimit');

const router = express.Router();

/* GET /api/mandi/prices */
router.get('/prices', async (req, res, next) => {
  try {
    const { commodity, state, district } = req.query;
    if (!commodity) return res.status(400).json({ error: 'Please provide a commodity.' });

    // district → state → all India: if the farmer's own mandi has nothing for
    // this crop we widen the search rather than showing an empty page.
    const { records, cached, stale, scope, requested } = await getMandiPricesWide({
      commodity,
      state: state || undefined,
      district: district || undefined,
      limit: 200,
      // ?fresh=1 → the farmer tapped "Show prices": bypass the cache so the
      // figures are live. If the government API is slow/down the service
      // falls back to the cached copy on its own.
      fresh: req.query.fresh === '1',
    });

    res.json({
      cached,
      stale: Boolean(stale),
      scope,
      requested,
      total: records.length,
      summary: summarise(records),
      records: records.slice(0, 60),
    });
  } catch (err) {
    next(err);
  }
});

/* POST /api/mandi/sell-advice — LLM reasoning over real price data */
router.post('/sell-advice', rateLimit({ windowMs: 10 * 60 * 1000, max: 10 }), async (req, res, next) => {
  try {
    const {
      commodity,
      state,
      district,
      quantityQuintals,
      totalCost,
      storageCostPerDay,
    } = req.body || {};

    if (!commodity || !quantityQuintals || !totalCost) {
      return res
        .status(400)
        .json({ error: 'commodity, quantityQuintals and totalCost are required.' });
    }

    const { records, scope, requested } = await getMandiPricesWide({
      commodity,
      state: state || undefined,
      district: district || undefined,
      limit: 200,
    });

    const summary = summarise(records);
    if (!summary) {
      return res.status(404).json({
        error:
          'No recent mandi data found for this commodity/location. Try a different spelling (e.g. "Onion") or a nearby state.',
      });
    }

    // Deterministic maths done in code (never trust an LLM with arithmetic)
    const qty = Number(quantityQuintals);
    const cost = Number(totalCost);
    const costPerQuintal = Math.round(cost / qty);
    const avgRevenue = summary.avgModalPrice * qty;
    const bestRevenue = summary.bestMarket.modalPrice * qty;
    const profitAtAvg = Math.round(avgRevenue - cost);
    const profitAtBest = Math.round(bestRevenue - cost);

    const facts = {
      commodity: summary.commodity,
      quantityQuintals: qty,
      avgModalPrice: summary.avgModalPrice,        // ₹/quintal across markets
      bestMarket: summary.bestMarket,
      worstMarket: summary.worstMarket,
      priceRange: [summary.minSeen, summary.maxSeen],
      recentTrend: summary.trend.slice(-7),        // avg price by arrival date
      yourCostPerQuintal: costPerQuintal,
      estimatedProfitAtAvgMarket: profitAtAvg,
      estimatedProfitAtBestMarket: profitAtBest,
      storageCostPerDay: Number(storageCostPerDay) || 0,
    };

    const lang = typeof req.body.lang === 'string' ? req.body.lang.slice(0, 40) : 'English';
    const messages = [
      {
        role: 'system',
        content: `You are KrishiSathi's market advisor for Indian farmers. You will be given VERIFIED mandi price data and farm economics computed by software. Using ONLY these facts, give a sell/hold/storage recommendation.

Return ONLY valid JSON:
{
  "recommendation": "SELL_NOW" | "HOLD" | "USE_STORAGE" | "DIRECT_BUYER" | "WAIT_FOR_BETTER_PRICE",
  "headline": "one-line summary in simple language",
  "reasoning": "2-4 short sentences explaining the maths simply (₹/quintal profit, market comparison)",
  "bestMarkets": ["market names with better prices, max 3"],
  "actionSteps": ["step 1", "step 2", "step 3"],
  "risks": ["things that could go wrong with this advice"],
  "disclaimer": "Based on government AGMARKNET data; prices change daily — confirm at the mandi before selling."
}
Guidelines: cost per quintal above avg modal price = farmer sells at a loss → suggest better markets or direct buyers, but be careful advising storage since prices may fall. storageCostPerDay matters if recommending USE_STORAGE. Keep language a farmer with basic education understands. Write every human-readable string field in ${lang}.`,
      },
      {
        role: 'user',
        content: `My crop: ${commodity}
Quantity: ${qty} quintals. My total production cost: ₹${cost} (₹${costPerQuintal}/quintal).
Storage cost if I hold: ₹${facts.storageCostPerDay || 0}/day.
State: ${state || 'any'}, District: ${district || 'any'}.

Verified mandi data (AGMARKNET, most recent records):
${JSON.stringify(facts, null, 2)}

Give me your recommendation.`,
      },
    ];

    const raw = await groqChat(messages, { json: true, maxTokens: 700, temperature: 0.3 });
    let advice;
    try {
      advice = JSON.parse(raw);
    } catch {
      const m = String(raw).match(/\{[\s\S]*\}/);
      advice = m ? JSON.parse(m[0]) : { headline: 'Could not generate advice', reasoning: raw };
    }

    res.json({ facts, advice });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
