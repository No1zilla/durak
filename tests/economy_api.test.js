const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { io } = require('socket.io-client');

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
          resolve({ status: res.statusCode, json: JSON.parse(body) });
        } catch (error) {
          reject(error);
        }
      });
    }).on('error', reject);
  });
}

function postJson(url, payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const req = http.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
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

function spawnServer(port, economyFile) {
  return spawn(process.execPath, ['server/server.js'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: 'development',
      ECONOMY_FILE: economyFile
    },
    stdio: 'ignore'
  });
}

function waitFor(socket, event, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), timeoutMs);
    socket.once(event, (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

async function authAs(url, playerId) {
  const socket = io(url, { transports: ['websocket'], timeout: 5000 });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('connect timeout')), 5000);
    socket.once('connect', () => { clearTimeout(timer); resolve(); });
    socket.once('connect_error', (err) => { clearTimeout(timer); reject(err); });
  });
  const pending = waitFor(socket, 'authSuccess');
  socket.emit('auth', { id: playerId, name: 'Тест', avatar: '' });
  const auth = await pending;
  return { socket, auth };
}

test('catalog, metrics, pending VK Pay, and wallet survive a process restart', async () => {
  const port = 3141;
  const origin = `http://127.0.0.1:${port}`;
  const restartPort = 3142;
  const restartOrigin = `http://127.0.0.1:${restartPort}`;
  const economyFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'durak-eco-api-')), 'state.json');
  const playerId = 'vk_persist_1';

  let child = spawnServer(port, economyFile);
  try {
    await waitForHttp(`${origin}/api/health`);

    const catalog = await getJson(`${origin}/api/shop/catalog`);
    assert.equal(catalog.status, 200);
    assert.ok(catalog.json.packs.some((pack) => pack.id === 'chips_10k'));
    assert.equal(catalog.json.starter.deck, 'deck_imperial');
    assert.ok(catalog.json.quests.some((quest) => quest.id === 'play_match'));

    const payPost = await postJson(`${origin}/api/vkpay/order`, { sku: 'chips_10k' });
    assert.equal(payPost.status, 401);

    const first = await authAs(origin, playerId);
    assert.equal(first.auth.userEconomy.chips, 5000);
    assert.equal(first.auth.userEconomy.dailyAvailable, true);

    const dailyPending = waitFor(first.socket, 'dailyBonusResult');
    first.socket.emit('claimDailyBonus');
    const daily = await dailyPending;
    assert.equal(daily.success, true);
    assert.equal(daily.reward.chips, 1500);
    assert.equal(daily.reward.streak, 1);
    assert.equal(daily.user.chips, 6500);

    const payPending = waitFor(first.socket, 'payOrderResult');
    first.socket.emit('createPayOrder', { sku: 'chips_10k' });
    const pay = await payPending;
    assert.equal(pay.success, true);
    assert.equal(pay.order.status, 'pending');

    const starterPending = waitFor(first.socket, 'starterResult');
    first.socket.emit('claimStarter');
    const starter = await starterPending;
    assert.equal(starter.success, true);
    assert.equal(starter.user.activeDeck, 'deck_imperial');
    assert.equal(starter.user.chips, 9000);

    const questPending = waitFor(first.socket, 'questResult');
    first.socket.emit('claimQuest', { questId: 'play_match' });
    const quest = await questPending;
    assert.equal(quest.success, false);

    first.socket.disconnect();

    const metrics = await getJson(`${origin}/api/metrics`);
    assert.equal(metrics.status, 200);
    assert.ok(metrics.json.users >= 1);
    assert.equal(metrics.json.payOrders, 1);
  } finally {
    child.kill('SIGTERM');
  }

  child = spawnServer(restartPort, economyFile);
  try {
    await waitForHttp(`${restartOrigin}/api/health`);
    const second = await authAs(restartOrigin, playerId);
    assert.equal(second.auth.userEconomy.chips, 9000);
    assert.equal(second.auth.userEconomy.starterClaimed, true);
    assert.equal(second.auth.userEconomy.dailyAvailable, false);
    assert.ok(second.auth.userEconomy.ownedDecks.includes('deck_imperial'));
    second.socket.disconnect();
  } finally {
    child.kill('SIGTERM');
  }
});
