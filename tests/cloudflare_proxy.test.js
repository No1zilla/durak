const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');

test('Cloudflare worker rewrites path and query onto Railway', async () => {
  const { outboundUrl, DEFAULT_RAILWAY_ORIGIN } = await import(
    pathToFileURL(path.join(__dirname, '../cloudflare/origin.js')).href
  );
  assert.equal(
    outboundUrl('https://durak-vk-proxy.user.workers.dev/socket.io/?EIO=4&transport=polling', DEFAULT_RAILWAY_ORIGIN),
    'https://durak-production-3b7a.up.railway.app/socket.io/?EIO=4&transport=polling'
  );
  assert.equal(
    outboundUrl('https://durak.example.ru/api/health', 'https://durak-production-3b7a.up.railway.app/'),
    'https://durak-production-3b7a.up.railway.app/api/health'
  );
});
