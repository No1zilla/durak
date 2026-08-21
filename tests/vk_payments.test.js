const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  signVkPaymentParams,
  verifyVkPaymentSignature,
  processVkNotification,
  flattenBody
} = require('../server/vkPayments');
const { EconomyService } = require('../server/services/economyService');

const SECRET = 'vk-test-secret';

function signed(params, secret = SECRET) {
  const body = { ...params };
  body.sig = signVkPaymentParams(body, secret);
  return body;
}

function makeEco() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'durak-pay-'));
  return new EconomyService({ filePath: path.join(dir, 'state.json') });
}

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

function postForm(url, payload) {
  return new Promise((resolve, reject) => {
    const data = new URLSearchParams(payload).toString();
    const req = http.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(data)
      }
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, json: JSON.parse(body) });
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

test('VK payment signature accepts only the matching secret', () => {
  const params = signed({
    app_id: '54720415',
    item: 'chips_10k',
    notification_type: 'get_item',
    user_id: '7'
  });
  assert.equal(verifyVkPaymentSignature(params, SECRET), true);
  assert.equal(verifyVkPaymentSignature(params, 'other'), false);
  assert.equal(verifyVkPaymentSignature({ ...params, sig: '00' }, SECRET), false);
});

test('get_item returns votes price; unknown SKU is error 20', () => {
  const eco = makeEco();
  const ok = processVkNotification(signed({
    app_id: '54720415',
    item: 'chips_10k',
    lang: 'ru_RU',
    notification_type: 'get_item',
    order_id: '10',
    receiver_id: '7',
    user_id: '7'
  }), eco, { secret: SECRET, appId: '54720415' });
  assert.equal(ok.json.response.price, 15);
  assert.equal(ok.json.response.item_id, 'chips_10k');

  const missing = processVkNotification(signed({
    app_id: '54720415',
    item: 'nope',
    notification_type: 'get_item',
    user_id: '7'
  }), eco, { secret: SECRET, appId: '54720415' });
  assert.equal(missing.json.error.error_code, 20);
});

test('order_status_change credits once; invalid signature does not pay', () => {
  const eco = makeEco();
  const body = {
    app_id: '54720415',
    item: 'chips_3k',
    item_price: '5',
    notification_type: 'order_status_change',
    order_id: '8800',
    receiver_id: '42',
    status: 'chargeable',
    user_id: '42'
  };
  const paid = processVkNotification(signed(body), eco, { secret: SECRET, appId: '54720415' });
  assert.equal(paid.json.response.order_id, 8800);
  assert.equal(eco.clientUser('vk_42').chips, 8000);

  const again = processVkNotification(signed(body), eco, { secret: SECRET, appId: '54720415' });
  assert.equal(again.json.response.app_order_id, paid.json.response.app_order_id);
  assert.equal(eco.clientUser('vk_42').chips, 8000);
  assert.equal(eco.getMetrics().payFulfilled, 1);

  const spoof = processVkNotification({ ...signed(body), order_id: '8801', sig: 'ffffffffffffffffffffffffffffffff' }, eco, {
    secret: SECRET,
    appId: '54720415'
  });
  assert.equal(spoof.json.error.error_code, 10);
  assert.equal(eco.clientUser('vk_42').chips, 8000);
});

test('missing secret does not fulfill even with a plausible body', () => {
  const eco = makeEco();
  const result = processVkNotification({
    app_id: '54720415',
    item: 'chips_10k',
    notification_type: 'order_status_change',
    order_id: '1',
    status: 'chargeable',
    user_id: '1',
    sig: 'anything'
  }, eco, { secret: '', appId: '54720415' });
  assert.equal(result.json.error.error_code, 1);
  assert.equal(eco.store.data.users.vk_1, undefined);
});

test('flattenBody keeps form arrays as the last value', () => {
  assert.deepEqual(flattenBody({ a: ['1', '2'], b: 3 }), { a: '2', b: '3' });
});

test('HTTP webhook verifies form signature and double-fulfill', async () => {
  const port = 3161;
  const origin = `http://127.0.0.1:${port}`;
  const economyFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'durak-pay-http-')), 'state.json');
  const child = spawn(process.execPath, ['server/server.js'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: 'development',
      ECONOMY_FILE: economyFile,
      VK_CLIENT_SECRET: SECRET,
      VK_APP_ID: '54720415'
    },
    stdio: 'ignore'
  });
  try {
    await waitForHttp(`${origin}/api/health`);
    const charge = signed({
      app_id: '54720415',
      date: '1700000000',
      item: 'chips_10k',
      item_price: '15',
      notification_type: 'order_status_change',
      order_id: '2044861',
      receiver_id: '99',
      status: 'chargeable',
      user_id: '99'
    });
    const first = await postForm(`${origin}/api/vkpay/notification`, charge);
    assert.equal(first.status, 200);
    assert.equal(first.json.response.order_id, 2044861);

    const second = await postForm(`${origin}/api/vkpay/notification`, charge);
    assert.equal(second.status, 200);
    assert.equal(second.json.response.app_order_id, first.json.response.app_order_id);

    const bad = await postForm(`${origin}/api/vkpay/notification`, { ...charge, sig: 'aa'.repeat(16) });
    assert.equal(bad.status, 200);
    assert.equal(bad.json.error.error_code, 10);

    const eco = new EconomyService({ filePath: economyFile });
    assert.equal(eco.clientUser('vk_99').chips, 15000);
    assert.equal(eco.getMetrics().payFulfilled, 1);
  } finally {
    child.kill('SIGTERM');
  }
});
