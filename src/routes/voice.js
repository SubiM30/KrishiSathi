/**
 * Voice routes — speech-to-text fallback (Groq Whisper, free tier).
 *
 * POST /api/voice/transcribe   body: raw audio (webm/ogg/mp4 from the
 *                             browser's MediaRecorder)
 *
 * Why this exists: on some Android phones the browser's built-in
 * speech recognition refuses to start ("service-not-allowed") even
 * with the microphone allowed. The app records the voice instead and
 * sends it here; Groq's Whisper model turns it into text in any of
 * the languages the app supports.
 */
const express = require('express');
const { rateLimit } = require('../middleware/rateLimit');

const router = express.Router();

router.post(
  '/transcribe',
  rateLimit({ windowMs: 5 * 60 * 1000, max: 20 }),
  express.raw({ type: () => true, limit: '12mb' }),
  async (req, res, next) => {
    try {
      if (!req.body || !req.body.length) {
        return res.status(400).json({ error: 'No audio received. Please try again.' });
      }
      if (!process.env.GROQ_API_KEY) {
        const err = new Error('GROQ_API_KEY missing');
        err.status = 503;
        err.publicMessage = 'The AI service is not configured yet. Ask the developer to add the Groq API key.';
        throw err;
      }

      const form = new FormData();
      form.append('file', new Blob([req.body], { type: req.headers['content-type'] || 'audio/webm' }), 'speech.webm');
      form.append('model', 'whisper-large-v3');
      form.append('response_format', 'json');
      // language is auto-detected by Whisper — works for all Indian languages

      const r = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
        body: form,
        signal: AbortSignal.timeout(30000),
      });

      if (!r.ok) {
        const text = await r.text().catch(() => '');
        const err = new Error(`Groq whisper failed (${r.status}): ${text.slice(0, 200)}`);
        err.status = r.status === 429 ? 429 : 502;
        err.publicMessage =
          r.status === 429
            ? 'Voice is busy right now — please wait a moment and try again.'
            : 'Voice recognition is temporarily unavailable. Please type your question instead.';
        throw err;
      }

      const data = await r.json();
      res.json({ text: (data.text || '').trim() });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
