const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');

async function load() {
  return import(pathToFileURL(path.join(__dirname, '../client/src/apiOrigin.js')).href);
}

test('same origin when Express hosts the client', async () => {
  const { resolveApiOrigin, needsRemoteApi } = await load();
  assert.equal(resolveApiOrigin({ hostname: 'localhost', search: '', configured: '' }), '');
  assert.equal(needsRemoteApi('localhost'), false);
});

test('query api= wins over runtime config', async () => {
  const { resolveApiOrigin } = await load();
  assert.equal(
    resolveApiOrigin({
      hostname: 'no1zilla.github.io',
      search: '?api=https://durak.up.railway.app/',
      configured: 'https://other.example'
    }),
    'https://durak.up.railway.app'
  );
});

test('GitHub Pages uses runtime config when no query', async () => {
  const { resolveApiOrigin, needsRemoteApi } = await load();
  assert.equal(
    resolveApiOrigin({
      hostname: 'no1zilla.github.io',
      search: '',
      configured: 'https://web-production.up.railway.app'
    }),
    'https://web-production.up.railway.app'
  );
  assert.equal(needsRemoteApi('no1zilla.github.io'), true);
});

test('GitHub Pages without config uses the Railway API', async () => {
  const { resolveApiOrigin, DEFAULT_PAGES_API } = await load();
  assert.equal(resolveApiOrigin({ hostname: 'no1zilla.github.io', search: '', configured: '' }), DEFAULT_PAGES_API);
});
