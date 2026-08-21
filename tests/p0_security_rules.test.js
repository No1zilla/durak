const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { DurakGame, GAME_STATES } = require('../server/gameEngine/DurakGame');
const { RoomManager } = require('../server/gameEngine/RoomManager');
const { verifyVkLaunchParams, cleanText, cleanImageUrl } = require('../server/security');

function signedLaunchParams(secret) {
  const params = new URLSearchParams({
    vk_app_id: '54720415',
    vk_user_id: '12345',
    vk_ts: '1786896000'
  });
  const payload = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
  params.set('sign', crypto.createHmac('sha256', secret).update(payload).digest('base64url'));
  return params.toString();
}

test('VK launch params require a valid signature', () => {
  const secret = 'test-secret';
  const params = signedLaunchParams(secret);
  assert.deepEqual(verifyVkLaunchParams(params, secret), { id: 'vk_12345', rawId: 12345 });
  assert.deepEqual(verifyVkLaunchParams(`?${params}`, secret), { id: 'vk_12345', rawId: 12345 });
  assert.deepEqual(verifyVkLaunchParams(`#/?${params}`, secret), { id: 'vk_12345', rawId: 12345 });
  assert.equal(verifyVkLaunchParams(params.replace('12345', '99999'), secret), null);
  assert.equal(verifyVkLaunchParams(params, 'wrong-secret'), null);
});

test('untrusted profile fields are sanitized', () => {
  assert.equal(cleanText('<img onerror="x">Иван', 'Гость'), 'img onerror=xИван');
  assert.equal(cleanImageUrl('javascript:alert(1)', ''), '');
  assert.equal(cleanImageUrl('https://example.com/a.png'), 'https://example.com/a.png');
});

test('only current attacker can open a round and phases are enforced', () => {
  const game = new DurakGame({ turnTimeLimit: 60 });
  for (let i = 0; i < 3; i++) game.addPlayer({ id: `p${i}`, name: `P${i}` });
  assert.equal(game.start(), true);

  const bystander = game.players.find(p =>
    p.id !== game.currentAttacker.id && p.id !== game.currentDefender.id);
  assert.equal(game.attack(bystander.id, bystander.hand[0].id).success, false);

  const attacker = game.currentAttacker;
  assert.equal(game.attack(attacker.id, attacker.hand[0].id).success, true);
  assert.equal(game.state, GAME_STATES.DEFENDING);
  assert.equal(game.attack(bystander.id, bystander.hand[0].id).success, false);
  assert.equal(game.pass(attacker.id).success, false);
  assert.equal(game.start(), false);
  assert.equal(game.addPlayer({ id: 'late' }), false);
  game.clearTurnTimer();
});

test('active rooms reject late players and bots', () => {
  const io = { to: () => ({ emit() {} }) };
  const rooms = new RoomManager(io);
  const room = rooms.createRoom({ maxPlayers: 4 }, { id: 'host', socketId: 's1' });
  assert.equal(rooms.joinRoom(room.id, { id: 'p2', socketId: 's2' }).success, true);
  assert.equal(room.game.start(), true);
  assert.equal(rooms.joinRoom(room.id, { id: 'late', socketId: 's3' }).success, false);
  assert.equal(rooms.addBot(room.id), false);
  room.game.clearTurnTimer();
});
