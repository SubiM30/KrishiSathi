/**
 * Groq API service — talks to the LLM and the vision model.
 * Docs: https://console.groq.com/docs
 *
 * Models used (both on the free tier):
 *   - openai/gpt-oss-120b  → chat + reasoning (farm advisor)
 *   - qwen/qwen3.8-27b     → vision (crop disease diagnosis from photos)
 *
 * We use plain fetch() — no SDK needed, since Groq's API follows the
 * same "OpenAI-compatible" request format.
 */
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

const CHAT_MODEL = 'openai/gpt-oss-120b';
const VISION_MODEL = 'qwen/qwen3.8-27b';

/**
 * Send a chat completion request.
 * @param {Array} messages  [{role:'system'|'user'|'assistant', content: string}, ...]
 * @param {object} options  { json: true } to force a JSON response
 */
async function groqChat(messages, options = {}) {
  if (!process.env.GROQ_API_KEY) {
    const err = new Error('GROQ_API_KEY missing');
    err.status = 503;
    err.publicMessage = 'The AI service is not configured yet. Ask the developer to add the Groq API key.';
    throw err;
  }

  const body = {
    model: CHAT_MODEL,
    messages,
    temperature: options.temperature ?? 0.4,
    max_tokens: options.maxTokens ?? 1400,
  };
  if (options.json) body.response_format = { type: 'json_object' };

  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`Groq chat failed (${res.status}): ${text.slice(0, 300)}`);
    err.status = res.status === 429 ? 429 : 502;
    err.publicMessage =
      res.status === 429
        ? 'The AI service is receiving too many requests right now. Please wait a minute and try again.'
        : 'The AI service is temporarily unavailable. Please try again shortly.';
    throw err;
  }

  const data = await res.json();
  return data.choices[0].message.content;
}

/**
 * Send an image + question to the vision model (crop diagnosis).
 * @param {string} imageDataUrl  "data:image/jpeg;base64,...." (or an https URL)
 * @param {string} prompt        instructions for the model
 */
async function groqVision(imageDataUrl, prompt) {
  if (!process.env.GROQ_API_KEY) {
    const err = new Error('GROQ_API_KEY missing');
    err.status = 503;
    err.publicMessage = 'The AI service is not configured yet. Ask the developer to add the Groq API key.';
    throw err;
  }

  const messages = [
    {
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: imageDataUrl } },
      ],
    },
  ];

  // The free Groq tier caps this vision model at ~1000 output tokens per
  // request — 1200 caused a "Request too large ... OTPM" 429 on every
  // diagnosis. 800 fits comfortably and is still plenty for the JSON.
  const callVision = async (maxTokens) => {
    const res = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: VISION_MODEL,
        messages,
        temperature: 0.2,
        max_tokens: maxTokens,
        response_format: { type: 'json_object' },
      }),
    });
    return res;
  };

  let res = await callVision(800);

  // If the reply was still too large for the tier, retry once, smaller
  if (res.status === 429) {
    const text = await res.text().catch(() => '');
    if (text.includes('output tokens')) {
      console.warn('[vision] output-token 429, retrying with 500 tokens');
      res = await callVision(500);
    } else {
      const err = new Error(`Groq vision failed (429): ${text.slice(0, 300)}`);
      err.status = 429;
      err.publicMessage =
        'Too many diagnosis requests right now — please wait a minute and try again.';
      throw err;
    }
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`Groq vision failed (${res.status}): ${text.slice(0, 300)}`);
    err.status = res.status === 429 ? 429 : 502;
    err.publicMessage =
      res.status === 429
        ? 'Too many diagnosis requests right now — please wait a minute and try again.'
        : 'Photo analysis is temporarily unavailable. Please try again shortly.';
    throw err;
  }

  const data = await res.json();
  const raw = data.choices[0].message.content;

  // The model is asked for JSON, but stay defensive: strip any code fences.
  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/); // grab the first {...} block
    if (match) return JSON.parse(match[0]);
    throw new Error('Vision model returned an unreadable response');
  }
}

module.exports = { groqChat, groqVision };
