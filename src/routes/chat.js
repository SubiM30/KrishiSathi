/**
 * POST /api/chat — AI farm assistant (gpt-oss-120b via Groq).
 * Body: { messages: [{role, content}, ...], language?: 'English'|'Hindi'|... }
 *
 * Multilingual text chat already works here — the model answers in
 * whatever Indian language the farmer writes in. (Voice = Bhashini, later.)
 */
const express = require('express');
const { groqChat } = require('../services/groq');
const { rateLimit } = require('../middleware/rateLimit');

const router = express.Router();

// 15 AI calls per 5 minutes per IP — protects the free Groq quota
router.use(rateLimit({ windowMs: 5 * 60 * 1000, max: 15 }));

const SYSTEM_PROMPT = `You are KrishiSathi, a friendly agricultural assistant for Indian farmers.

Guidelines:
- Answer in the SAME language the farmer writes in (Hindi, English, Marathi, Tamil, Telugu, Bengali, Kannada, Gujarati, Punjabi, Odia, etc.).
- Use simple words and short sentences. Assume the reader may have low literacy.
- Give practical, specific advice suited to Indian farming conditions (crops, seasons like kharif/rabi/zaid, monsoon timing).
- Use metric units, ₹ for money, and Indian conventions (quintal, acre, bigha — explain conversions when relevant).
- If a question needs local market prices or current weather, tell the farmer to check the "Mandi Prices" or "Weather" sections of the app, since you do not have live data.
- For pesticides/chemicals, always mention dosage carefully and suggest consulting a local Krishi Vigyan Kendra (KVK) or agriculture officer when unsure.
- Never invent statistics or prices. If unsure, say so honestly.
- Write in plain, well-structured prose: short paragraphs and simple bullet lists.
- NEVER use markdown tables. Not for comparisons, not for lists of crops, not
  for prices. If you would reach for a table, use short bullet lines instead
  (e.g. "- Bengal gram: grows well with moderate rain, good demand").
- Be concise but COMPLETE. Aim for roughly 120-200 words: a short answer, then
  3-5 practical bullets. Never stop mid-sentence and never leave a thought
  unfinished — finish your last point properly.
- Be warm and encouraging. Farmers matter.`;

router.post('/', async (req, res, next) => {
  try {
    const history = Array.isArray(req.body.messages) ? req.body.messages.slice(-12) : [];
    if (!history.length) return res.status(400).json({ error: 'No messages provided.' });

    // Keep only safe, well-formed entries
    const clean = history
      .filter((m) => m && typeof m.content === 'string' && m.content.trim().length > 0)
      .map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content.slice(0, 2000),
      }))
      .slice(-10);
    if (!clean.length) return res.status(400).json({ error: 'No valid messages provided.' });

    // The app sends the UI language ("Hindi", "Tamil"...) so the reply
    // matches what the farmer is reading on screen.
    const lang = typeof req.body.lang === 'string' ? req.body.lang.slice(0, 40) : 'English';
    let system = `${SYSTEM_PROMPT}\nIMPORTANT: Write your entire reply in ${lang}.`;

    // The farmer's profile (crop, costs, location) travels with every
    // request so the AI can personalise answers to their actual farm.
    const p = req.body.profile;
    if (p && typeof p === 'object') {
      const bits = [];
      if (p.name) bits.push(`Farmer's name: ${String(p.name).slice(0, 40)}`);
      if (p.commodity) bits.push(`Current crop: ${String(p.commodity).slice(0, 40)}`);
      if (Number(p.qty) > 0) bits.push(`Harvest quantity: ${Number(p.qty)} quintals`);
      if (Number(p.cost) > 0) {
        const perQ = Number(p.qty) > 0 ? ` (about ₹${Math.round(Number(p.cost) / Number(p.qty))}/quintal)` : '';
        bits.push(`Total production cost so far: ₹${Number(p.cost)}${perQ}`);
      }
      if (Number(p.storage) > 0) bits.push(`Storage cost if they hold the crop: ₹${Number(p.storage)}/day`);
      const loc = [p.district, p.state].filter(Boolean).join(', ');
      if (loc) bits.push(`Location: ${loc}, India`);
      // The farmer's whole farm travels with the request so answers can be
      // personal (all crops, their stage, cost and expected yield).
      if (Array.isArray(p.crops) && p.crops.length) {
        const lines = p.crops.slice(0, 6).map((c) => {
          const bits2 = [String(c.commodity || '').slice(0, 30)];
          if (c.area) bits2.push(`${c.area} ${c.areaUnit || 'acre'}`);
          if (c.stage) bits2.push(`stage: ${String(c.stage).slice(0, 30)}`);
          if (Number(c.expectedYield) > 0) bits2.push(`${Number(c.expectedYield)} q expected`);
          if (Number(c.cost) > 0) bits2.push(`cost ₹${Number(c.cost)}`);
          return bits2.join(' · ');
        });
        bits.push(`Crops being grown:\n  - ${lines.join('\n  - ')}`);
      }
      if (bits.length) {
        system += `\n\nFarmer's profile — personalise answers using this (do not repeat it back unless asked):\n- ${bits.join('\n- ')}`;
      }
    }

    const reply = await groqChat(
      [{ role: 'system', content: system }, ...clean],
      { maxTokens: 1500, temperature: 0.5 }
    );

    res.json({ reply });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
