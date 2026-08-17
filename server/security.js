const crypto = require('crypto');

function verifyVkLaunchParams(rawParams, secret) {
  if (!rawParams || !secret) return null;

  const params = new URLSearchParams(rawParams.startsWith('?') ? rawParams.slice(1) : rawParams);
  const sign = params.get('sign');
  const userId = params.get('vk_user_id');
  if (!sign || !/^\d+$/.test(userId || '')) return null;

  const payload = [...params.entries()]
    .filter(([key]) => key.startsWith('vk_'))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');

  const expected = crypto.createHmac('sha256', secret)
    .update(payload)
    .digest('base64url');

  if (sign.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(sign), Buffer.from(expected))) {
    return null;
  }

  return { id: `vk_${userId}`, rawId: Number(userId) };
}

function cleanText(value, fallback, maxLength = 40) {
  if (typeof value !== 'string') return fallback;
  const cleaned = value.trim().replace(/[<>&"'`\u0000-\u001f]/g, '').slice(0, maxLength);
  return cleaned || fallback;
}

function cleanImageUrl(value, fallback = '') {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href.slice(0, 500) : fallback;
  } catch {
    return fallback;
  }
}

module.exports = { verifyVkLaunchParams, cleanText, cleanImageUrl };
