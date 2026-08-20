function extraOrigins() {
  return String(process.env.FRONTEND_ORIGINS || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
}

function originAllowed(origin) {
  if (!origin) return true;
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true;
  if (origin === 'https://no1zilla.github.io') return true;
  if (/^https:\/\/[a-z0-9-]+\.up\.railway\.app$/.test(origin)) return true;
  return extraOrigins().includes(origin);
}

function corsMiddleware(req, res, next) {
  const origin = req.headers.origin;
  if (origin && originAllowed(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
}

module.exports = { originAllowed, corsMiddleware };
