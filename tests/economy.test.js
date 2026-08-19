const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EconomyService } = require('../server/services/economyService');

function makeService(nowValue) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'durak-eco-'));
  const filePath = path.join(dir, 'state.json');
  let now = nowValue || Date.now();
  const service = new EconomyService({ filePath, now: () => now });
  service.shift = (ms) => { now += ms; };
  service.filePath = filePath;
  return service;
}

test('wallet and inventory survive reload', () => {
  const eco = makeService();
  eco.buySkin('u1', 'decks', 'deck_imperial', 'chips');
  const reloaded = new EconomyService({ filePath: eco.filePath });
  const user = reloaded.clientUser('u1');
  assert.equal(user.chips, 2500);
  assert.ok(user.ownedDecks.includes('deck_imperial'));
});

test('ledger is idempotent for the same key', () => {
  const eco = makeService();
  const first = eco.credit('u2', 'chips', 100, 'test', 'once:u2');
  const second = eco.credit('u2', 'chips', 100, 'test', 'once:u2');
  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.equal(eco.getUser('u2').chips, 5100);
});

test('daily streak grows across days and resets after a skip', () => {
  const eco = makeService(1_700_000_000_000);
  const day1 = eco.claimDailyReward('u3');
  assert.equal(day1.reward.streak, 1);
  eco.shift(24 * 60 * 60 * 1000 + 10);
  const day2 = eco.claimDailyReward('u3');
  assert.equal(day2.reward.streak, 2);
  eco.shift(48 * 60 * 60 * 1000);
  const afterSkip = eco.claimDailyReward('u3');
  assert.equal(afterSkip.reward.streak, 1);
});

test('rewarded ads stop after the daily cap', () => {
  const eco = makeService();
  assert.equal(eco.claimRewardedAd('u4').success, true);
  assert.equal(eco.claimRewardedAd('u4').success, true);
  assert.equal(eco.claimRewardedAd('u4').success, true);
  assert.equal(eco.claimRewardedAd('u4').success, false);
});

test('starter pack can be claimed once and equips imperial deck', () => {
  const eco = makeService();
  const first = eco.claimStarter('u5');
  assert.equal(first.success, true);
  assert.equal(first.user.activeDeck, 'deck_imperial');
  assert.equal(eco.claimStarter('u5').success, false);
});

test('VK Pay order is pending and does not grant chips', () => {
  const eco = makeService();
  const before = eco.clientUser('u6').chips;
  const order = eco.createPayOrder('u6', 'chips_10k');
  assert.equal(order.success, true);
  assert.equal(order.order.status, 'pending');
  assert.equal(eco.clientUser('u6').chips, before);
});

test('quests pay only after completion', () => {
  const eco = makeService();
  assert.equal(eco.claimQuest('u7', 'play_match').success, false);
  eco.getUser('u7').quests.play = true;
  const claimed = eco.claimQuest('u7', 'play_match');
  assert.equal(claimed.success, true);
  assert.equal(eco.claimQuest('u7', 'play_match').success, false);
});
