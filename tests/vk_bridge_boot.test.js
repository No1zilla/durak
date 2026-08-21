const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');

async function load() {
  return import(pathToFileURL(path.join(__dirname, '../client/src/vkBridge.js')).href);
}

test('VK hash /#/? launch params are parsed like query params', async () => {
  const { getLaunchParamsString, mergeLaunchParams, normalizeLaunchQuery } = await load();
  const query = 'vk_user_id=12345&vk_app_id=54720415&sign=abc';
  assert.equal(normalizeLaunchQuery(`#/?${query}`), query);
  assert.equal(mergeLaunchParams('', `#/?${query}`).get('vk_user_id'), '12345');
  assert.equal(getLaunchParamsString('', `#/?${query}`), `?${query}`);
  assert.equal(getLaunchParamsString(`?${query}`, ''), `?${query}`);
});

test('guest identity survives blocked third-party localStorage', async () => {
  const { createGuestUser, safeStorageGet, safeStorageSet } = await load();
  const blocked = {
    configurable: true,
    get() {
      throw new Error('SecurityError: Failed to read the localStorage property');
    }
  };
  Object.defineProperty(globalThis, 'localStorage', blocked);
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    get() {
      throw new Error('SecurityError: Failed to read the sessionStorage property');
    }
  });

  try {
    assert.equal(safeStorageGet('durak_guest_id'), null);
    safeStorageSet('durak_guest_id', 'guest_mem');
    assert.equal(safeStorageGet('durak_guest_id'), 'guest_mem');

    const user = createGuestUser('', '');
    assert.match(user.id, /^guest_/);
    assert.equal(user.rawId, 0);
    assert.ok(user.name);

    const fromVk = createGuestUser('?vk_user_id=777&sign=fake', '');
    assert.equal(fromVk.id, 'guest_vk_777');
    assert.equal(fromVk.rawId, 777);
  } finally {
    delete globalThis.localStorage;
    delete globalThis.sessionStorage;
  }
});

test('rewarded ads and order box do not succeed outside VK', async () => {
  const { vk } = await load();
  assert.equal(await vk.showRewardedAd(), false);
  const order = await vk.showOrderBox('chips_10k');
  assert.equal(order.ok, false);
  assert.equal(order.skipped, true);
});
