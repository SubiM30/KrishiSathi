/**
 * POST /api/market/image — store one optional listing photo.
 *
 * The browser shrinks the picture before sending it, so what arrives is a
 * data URL of well under 1 MB. Only the URL is kept on the listing; the
 * image itself lives in Cloudinary.
 */
const express = require('express');
const { uploadToCloudinary } = require('../services/cloudinary');
const { rateLimit } = require('../middleware/rateLimit');

const router = express.Router();

router.use(rateLimit({ windowMs: 10 * 60 * 1000, max: 20 }));

router.post('/image', async (req, res) => {
  const { image } = req.body || {};
  if (!image || typeof image !== 'string' || !image.startsWith('data:image/')) {
    return res.status(400).json({ error: 'A base64 image data URL is required.' });
  }
  try {
    const url = await uploadToCloudinary(image, 'krishisathi/market');
    if (!url) {
      return res.status(503).json({
        error: 'Image storage is not configured. Add the CLOUDINARY_* keys to post photos.',
      });
    }
    return res.json({ url });
  } catch (err) {
    console.warn('[warn] market image upload failed:', err.message);
    return res.status(503).json({ error: 'Could not store the photo just now.' });
  }
});

module.exports = router;
