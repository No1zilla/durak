const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { spawn } = require('child_process');
const path = require('path');

function waitForHttp(url, timeoutMs = 15000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      http.get(url, (res) => {
        res.resume();
        resolve();
      }).on('error', () => {
        if (Date.now() - started > timeoutMs) reject(new Error(`timeout waiting for ${url}`));
        else setTimeout(tick, 100);
      });
    };
    tick();
  });
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, json: JSON.parse(body), headers: res.headers });
        } catch (error) {
          reject(error);
        }
      });
    }).on('error', reject);
  });
}

test('/api/health reports ok and buildSha', async () => {
  const port = 3127;
  const child = spawn(process.execPath, ['server/server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(port), NODE_ENV: 'development', GIT_COMMIT_SHA: 'testsha' },
    stdio: 'ignore'
  });
  try {
    await waitForHttp(`http://127.0.0.1:${port}/api/health`);
    const { status, json, headers } = await getJson(`http://127.0.0.1:${port}/api/health`);
    assert.equal(status, 200);
    assert.equal(json.ok, true);
    assert.equal(json.buildSha, 'testsha');
    assert.equal(json.vkAppId, '54720415');
    assert.equal(headers['x-durak-build'], 'testsha');
  } finally {
    child.kill('SIGTERM');
  }
});
