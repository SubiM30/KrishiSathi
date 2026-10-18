/**
 * POST /api/summarise  →  { summary }
 *
 * Turns a long AI report (a crop diagnosis, or selling advice) into 2–4 short
 * sentences written to be LISTENED to. The "read aloud" buttons call this so
 * the farmer hears the gist instead of every heading, badge and keyword.
 *
 * Body: { text: string, lang: string }
 */
const express = require('express');
const { groqChat } = require('../services/groq');
const { rateLimit } = require('../middleware/rateLimit');

const router = express.Router();

const SYSTEM = `You are KrishiSathi, a friendly agricultural assistant for Indian farmers.
You are given a report — either a crop disease diagnosis or selling advice.
Rewrite it as a SHORT summary that will be read aloud to the farmer.

Rules:
- 2 to 4 short sentences. Nothing else.
- No headings, no bullet points, no markdown, no emoji, no tables.
- Everyday, warm, spoken language — as if explaining to a friend on the phone.
- Keep only what matters: what the problem is, what to do about it, and any warning.
- Do not add anything that is not in the report, and never invent numbers or prices.
- If the report says the crop looks healthy, say that plainly and briefly.`;

router.post('/', rateLimit({ windowMs: 10 * 60 * 1000, max: 40 }), async (req, res, next) => {
  try {
    const text = String((req.body && req.body.text) || '').slice(0, 4000).trim();
    const lang = String((req.body && req.body.lang) || 'English').slice(0, 40);
    if (text.length < 10) return res.status(400).json({ error: 'Nothing to summarise.' });

    const reply = await groqChat(
      [
        { role: 'system', content: `${SYSTEM}\nIMPORTANT: Write the whole summary in ${lang}.` },
        { role: 'user', content: text },
      ],
      { maxTokens: 240, temperature: 0.3 }
    );

    const summary = String(reply || '').replace(/\s+/g, ' ').trim();
    if (!summary) return res.status(502).json({ error: 'Could not summarise right now.' });
    res.json({ summary });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
