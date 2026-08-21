const crypto = require('crypto');

function extractVkLaunchQuery(rawParams) {
  if (!rawParams || typeof rawParams !== 'string') return '';

  let search = '';
  let hash = '';
  const trimmed = rawParams.trim();

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      search = url.search;
      hash = url.hash;
    } catch {
      return '';
    }
  } else if (trimmed.startsWith('#')) {
    hash = trimmed;
  } else if (trimmed.includes('#')) {
    const hashIndex = trimmed.indexOf('#');
    search = trimmed.slice(0, hashIndex);
    hash = trimmed.slice(hashIndex);
  } else {
    search = trimmed;
  }

  const merged = new URLSearchParams();
  const add = (raw) => {
    if (!raw) return;
    let query = raw.startsWith('?') || raw.startsWith('#') ? raw.slice(1) : raw;
    if (query.startsWith('/?')) query = query.slice(2);
    else if (query.startsWith('/')) query = query.slice(1);
    if (!query) return;
    for (const [key, value] of new URLSearchParams(query)) {
      merged.set(key, value);
    }
  };

  add(search);
  add(hash);
  return merged.toString();
}

function verifyVkLaunchParams(rawParams, secret) {
  if (!rawParams || !secret) return null;

  const params = new URLSearchParams(extractVkLaunchQuery(rawParams));
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

function resolvePlayerIdentity({ launchParams, clientId, secret, nodeEnv, socketId }) {
  const query = extractVkLaunchQuery(launchParams);
  const signed = verifyVkLaunchParams(query, secret);
  if (query && secret && !signed) {
    return { error: 'Неверная подпись VK' };
  }
  if (signed) {
    return { id: signed.id, rawId: signed.rawId, verified: true };
  }

  const params = new URLSearchParams(query);
  const vkUserId = params.get('vk_user_id');
  const looksLikeVk = params.get('sign') && params.get('vk_app_id') && /^\d+$/.test(vkUserId || '');
  if (!secret && looksLikeVk) {
    return { id: `guest_vk_${vkUserId}`, rawId: Number(vkUserId), verified: false };
  }

  if (nodeEnv !== 'production' && clientId) {
    return { id: String(clientId), rawId: 0, verified: false };
  }

  return { id: `guest_${socketId}`, rawId: 0, verified: false };
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

module.exports = {
  extractVkLaunchQuery,
  verifyVkLaunchParams,
  resolvePlayerIdentity,
  cleanText,
  cleanImageUrl
};
