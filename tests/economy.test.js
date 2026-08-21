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

test('ECONOMY_FILE env wins over the default json path', () => {
  const { resolveEconomyFile } = require('../server/services/economyService');
  assert.equal(resolveEconomyFile({ ECONOMY_FILE: '/data/state.json' }), '/data/state.json');
});

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

test('rewarded ads require a watch, stop after the daily cap, and cool down', () => {
  const eco = makeService();
  assert.equal(eco.claimRewardedAd('u4').success, false);
  assert.equal(eco.claimRewardedAd('u4', { watched: true }).success, true);
  eco.shift(9000);
  assert.equal(eco.claimRewardedAd('u4', { watched: true }).success, true);
  eco.shift(9000);
  assert.equal(eco.claimRewardedAd('u4', { watched: true }).success, true);
  eco.shift(9000);
  assert.equal(eco.claimRewardedAd('u4', { watched: true }).success, false);
  assert.equal(eco.clientUser('u4').chips, 6200);
  assert.equal(eco.clientUser('u4').rewardedLeft, 0);
});

test('rewarded ads reject a second claim inside the cooldown window', () => {
  const eco = makeService();
  assert.equal(eco.claimRewardedAd('u4b', { watched: true }).success, true);
  const blocked = eco.claimRewardedAd('u4b', { watched: true });
  assert.equal(blocked.success, false);
  assert.match(blocked.error, /секунд/);
  assert.equal(eco.clientUser('u4b').chips, 5400);
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

test('VK votes webhook grants chips once and ignores a second fulfill', () => {
  const eco = makeService();
  const first = eco.fulfillVkOrder({ userId: '9001', orderId: '555', skuId: 'chips_10k' });
  const second = eco.fulfillVkOrder({ userId: '9001', orderId: '555', skuId: 'chips_10k' });
  assert.equal(first.success, true);
  assert.equal(first.duplicate, false);
  assert.equal(second.success, true);
  assert.equal(second.duplicate, true);
  assert.equal(second.appOrderId, first.appOrderId);
  assert.equal(eco.clientUser('vk_9001').chips, 15000);
  assert.equal(eco.clientUser('vk_9001').gold, 70);
  assert.equal(eco.getMetrics().payFulfilled, 1);
});

test('quests pay only after completion', () => {
  const eco = makeService();
  assert.equal(eco.claimQuest('u7', 'play_match').success, false);
  eco.getUser('u7').quests.play = true;
  const claimed = eco.claimQuest('u7', 'play_match');
  assert.equal(claimed.success, true);
  assert.equal(eco.claimQuest('u7', 'play_match').success, false);
});

test('match settle pays the human winner once and marks daily quests', () => {
  const eco = makeService();
  const room = {
    game: {
      id: 'room_settle',
      state: 'GAME_OVER',
      players: [
        { id: 'winner', isBot: false },
        { id: 'durak', isBot: false },
        { id: 'bot_x', isBot: true }
      ],
      winners: [{ id: 'winner' }],
      durak: { id: 'durak' }
    }
  };
  eco.settleMatch(room);
  eco.settleMatch(room);
  const winner = eco.clientUser('winner');
  const loser = eco.clientUser('durak');
  assert.equal(winner.chips, 5050);
  assert.equal(winner.totalWins, 1);
  assert.equal(winner.quests.play, true);
  assert.equal(winner.quests.win, true);
  assert.equal(loser.chips, 5000);
  assert.equal(loser.winStreak, 0);
  assert.equal(loser.quests.play, true);
  assert.equal(loser.quests.win, false);
  assert.equal(eco.getMetrics().matchesCompleted, 1);
  assert.equal(eco.store.data.users.bot_x, undefined);
});

test('RoomManager startMatch and GAME_OVER fire hooks once', () => {
  const { RoomManager } = require('../server/gameEngine/RoomManager');
  const { GAME_STATES } = require('../server/gameEngine/DurakGame');
  let started = 0;
  let settled = 0;
  const io = { to: () => ({ emit() {} }) };
  const rooms = new RoomManager(io, {
    onMatchStart() { started += 1; },
    onGameOver() { settled += 1; }
  });
  const room = rooms.createRoom({ maxPlayers: 2 }, { id: 'host', socketId: 's1' });
  assert.equal(rooms.addBot(room.id), true);
  assert.equal(started, 1);
  room.game.state = GAME_STATES.GAME_OVER;
  rooms.broadcastState(room.id);
  rooms.broadcastState(room.id);
  assert.equal(settled, 1);
  room.game.clearTurnTimer();
});
