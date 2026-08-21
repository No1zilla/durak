const test = require('node:test');
const assert = require('node:assert/strict');
const { originAllowed } = require('../server/cors');

test('allows GitHub Pages origin for the API', () => {
  assert.equal(originAllowed('https://no1zilla.github.io'), true);
});

test('allows local dev origins', () => {
  assert.equal(originAllowed('http://localhost:3000'), true);
  assert.equal(originAllowed('http://127.0.0.1:4173'), true);
});

test('rejects random sites', () => {
  assert.equal(originAllowed('https://evil.example'), false);
});
