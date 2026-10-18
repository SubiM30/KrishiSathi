/**
 * POST /api/diagnose — crop disease / pest diagnosis from a photo.
 *
 * Flow:
 *   1. Farmer uploads a photo in the browser (as base64 data URL).
 *   2. (Optional) Backend stores it in Cloudinary for the farmer's history.
 *   3. Photo goes to Groq's vision model (qwen/qwen3.8-27b), which returns
 *      a structured JSON diagnosis (disease, severity, organic + chemical
 *      treatment, prevention).
 */
const crypto = require('crypto');
const express = require('express');
const { groqVision } = require('../services/groq');
const { rateLimit } = require('../middleware/rateLimit');

const router = express.Router();

// Diagnoses are expensive (image + vision model): 8 per 10 minutes per IP
router.use(rateLimit({ windowMs: 10 * 60 * 1000, max: 8 }));

const VISION_PROMPT = `You are an expert Indian plant pathologist and entomologist.

Analyse this photo, which an Indian farmer uploaded from their field.

Return ONLY valid JSON with exactly these keys:
{
  "isCropPhoto": true/false,          // false if there is no plant/leaf/crop in the image
  "cropGuess": "best guess of the crop, or null",
  "problem": "most likely disease, pest or deficiency — or 'Healthy' — or null if not a crop photo",
  "confidence": "High | Medium | Low",
  "severity": "None | Mild | Moderate | Severe",
  "symptoms": "what is visible that led to this conclusion (1-2 sentences)",
  "organicTreatment": "steps using neem, cow dung, compost, traps etc. (short bullet points in one string)",
  "chemicalTreatment": "recommended chemical names + dosage per acre/spray, or 'Consult local KVK' if unsure",
  "prevention": "how to prevent this problem next season",
  "ifHealthy": "general care tips for this crop (only when the plant looks healthy)",
  "disclaimer": "AI advice — verify with your local agriculture officer or KVK before major action."
}

Be honest about uncertainty. Never invent a disease you cannot see evidence for.`;

/** Upload a base64 image to Cloudinary (signed, no SDK needed). Returns null if not configured. */
async function uploadToCloudinary(dataUrl) {
  const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env;
  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) return null;

  const timestamp = Math.floor(Date.now() / 1000);
  const folder = 'krishisathi/diagnoses';
  // Signed uploads require: sha1("folder=<f>&timestamp=<t><api_secret>")
  const signature = crypto
    .createHash('sha1')
    .update(`folder=${folder}&timestamp=${timestamp}${CLOUDINARY_API_SECRET}`)
    .digest('hex');

  const form = new FormData();
  form.append('file', dataUrl);
  form.append('api_key', CLOUDINARY_API_KEY);
  form.append('timestamp', String(timestamp));
  form.append('folder', folder);
  form.append('signature', signature);

  const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) return null; // storage is best-effort; diagnosis can continue
  const data = await res.json();
  return data.secure_url;
}

router.post('/', async (req, res, next) => {
  try {
    const imageDataUrl = req.body.image;
    const notes = typeof req.body.notes === 'string' ? req.body.notes.slice(0, 300) : '';

    if (!imageDataUrl || !/^data:image\/(jpeg|jpg|png|webp);base64,/.test(imageDataUrl)) {
      return res.status(400).json({ error: 'Please upload a valid JPG, PNG or WebP photo.' });
    }
    if (imageDataUrl.length > 6 * 1024 * 1024) {
      return res.status(400).json({ error: 'Photo is too large. Please upload a photo under ~4 MB.' });
    }

    // 1) Store in Cloudinary (optional — skipped gracefully if not configured)
    let imageUrl = null;
    try {
      imageUrl = await uploadToCloudinary(imageDataUrl);
    } catch (e) {
      console.warn('Cloudinary upload skipped:', e.message);
    }

    // 2) Vision diagnosis (reply in the app's UI language)
    const lang = typeof req.body.lang === 'string' ? req.body.lang.slice(0, 40) : 'English';
    const langLine = `Write every text field (cropGuess, problem, symptoms, treatments, prevention, ifHealthy, disclaimer) in ${lang}.`;
    const prompt = notes
      ? `${VISION_PROMPT}\n${langLine}\n\nFarmer's note about the crop: "${notes}"`
      : `${VISION_PROMPT}\n${langLine}`;

    const diagnosis = await groqVision(imageDataUrl, prompt);
    res.json({ diagnosis, imageUrl, stored: Boolean(imageUrl) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
