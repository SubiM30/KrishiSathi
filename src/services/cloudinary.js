/**
 * Cloudinary image storage.
 *
 * Shared by the crop-doctor diagnoses and the market listings: both upload a
 * base64 data URL straight from the browser and keep only the returned URL.
 * Signed upload — no SDK needed.
 *
 * If the three CLOUDINARY_* env vars are missing this returns null and the
 * caller carries on without an image, so the app never depends on storage
 * being configured.
 */
const crypto = require('crypto');

async function uploadToCloudinary(dataUrl, folder = 'krishisathi/uploads') {
  const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env;
  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) return null;

  const timestamp = Math.floor(Date.now() / 1000);
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
  if (!res.ok) return null; // storage is best-effort
  const data = await res.json();
  return data.secure_url;
}

module.exports = { uploadToCloudinary };
