const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');

async function loadOrigin() {
  return import(pathToFileURL(path.join(__dirname, '../client/src/apiOrigin.js')).href);
}

async function loadProbe() {
  return import(pathToFileURL(path.join(__dirname, '../client/src/bootProbe.js')).href);
}

test('same origin when Express or Cloudflare proxy hosts the client', async () => {
  const { resolveApiOrigin, needsRemoteApi, isRailwayHost } = await loadOrigin();
  assert.equal(resolveApiOrigin({ hostname: 'localhost', search: '', configured: '' }), '');
  assert.equal(resolveApiOrigin({ hostname: 'durak-vk-proxy.user.workers.dev', search: '', configured: '' }), '');
  assert.equal(resolveApiOrigin({ hostname: 'durak.example.ru', search: '', configured: '' }), '');
  assert.equal(needsRemoteApi('durak-vk-proxy.user.workers.dev'), false);
  assert.equal(isRailwayHost('durak-production-3b7a.up.railway.app'), true);
  assert.equal(isRailwayHost('durak.example.ru'), false);
});

test('query api= wins over runtime config', async () => {
  const { resolveApiOrigin } = await loadOrigin();
  assert.equal(
    resolveApiOrigin({
      hostname: 'no1zilla.github.io',
      search: '?api=https://durak-vk-proxy.user.workers.dev/',
      configured: 'https://other.example'
    }),
    'https://durak-vk-proxy.user.workers.dev'
  );
});

test('static hosts need a remote API and default to Railway unless configured', async () => {
  const { resolveApiOrigin, needsRemoteApi, DEFAULT_PAGES_API, isStaticHost } = await loadOrigin();
  assert.equal(isStaticHost('no1zilla.github.io'), true);
  assert.equal(isStaticHost('production.vk-apps.com'), true);
  assert.equal(needsRemoteApi('no1zilla.github.io'), true);
  assert.equal(
    resolveApiOrigin({ hostname: 'no1zilla.github.io', search: '', configured: '' }),
    DEFAULT_PAGES_API
  );
  assert.equal(
    resolveApiOrigin({
      hostname: 'hash.vk-apps.com',
      search: '',
      configured: 'https://durak-vk-proxy.user.workers.dev/'
    }),
    'https://durak-vk-proxy.user.workers.dev'
  );
});

test('boot classifier names a Railway geo block vs socket vs VK sign', async () => {
  const { classifyBootFailure } = await loadProbe();

  const railway = classifyBootFailure({
    hostname: 'durak-production-3b7a.up.railway.app',
    apiOrigin: '',
    htmlLoaded: true,
    healthOk: false
  });
  assert.equal(railway.code, 'railway_blocked');
  assert.match(railway.message, /Cloudflare/);

  const socket = classifyBootFailure({
    hostname: 'no1zilla.github.io',
    apiOrigin: 'https://durak-production-3b7a.up.railway.app',
    htmlLoaded: true,
    healthOk: true,
    socketConnected: false
  });
  assert.equal(socket.code, 'socket');
  assert.match(socket.message, /Cloudflare/);

  const sign = classifyBootFailure({
    hostname: 'durak.example.ru',
    htmlLoaded: true,
    healthOk: true,
    socketConnected: true,
    authError: 'Неверная подпись VK'
  });
  assert.equal(sign.code, 'vk_sign');
  assert.equal(sign.message, 'Неверная подпись VK');
});

test('client no longer tells the VK cabinet to use the Railway hostname', async () => {
  const fs = require('fs');
  const html = fs.readFileSync(path.join(__dirname, '../client/index.html'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '../client/src/app.js'), 'utf8');
  const readme = fs.readFileSync(path.join(__dirname, '../README.md'), 'utf8');
  assert.match(html, /boot-host/);
  assert.doesNotMatch(app, /укажите URL Railway/);
  assert.match(readme, /workers\.dev/);
  assert.match(readme, /не Railway/);
});
