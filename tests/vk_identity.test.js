const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const {
  extractVkLaunchQuery,
  verifyVkLaunchParams,
  resolvePlayerIdentity
} = require('../server/security');
const { RoomManager } = require('../server/gameEngine/RoomManager');

function signedLaunchParams(secret, extra = {}) {
  const params = new URLSearchParams({
    vk_app_id: '54720415',
    vk_user_id: '12345',
    vk_ts: '1786896000',
    ...extra
  });
  const payload = [...params.entries()]
    .filter(([key]) => key.startsWith('vk_'))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
  params.set('sign', crypto.createHmac('sha256', secret).update(payload).digest('base64url'));
  return params.toString();
}

test('launch params from hash and full URL are parsed', () => {
  const query = 'vk_user_id=12345&vk_app_id=54720415&sign=abc';
  assert.equal(extractVkLaunchQuery(`#${query}`), query);
  assert.equal(extractVkLaunchQuery(`https://game.example/?foo=1#${query}`), `foo=1&${query}`);
  assert.equal(extractVkLaunchQuery(`?${query}`), query);
});

test('signed hash params verify the same as query params', () => {
  const secret = 'test-secret';
  const signed = signedLaunchParams(secret);
  assert.deepEqual(verifyVkLaunchParams(`#${signed}`, secret), { id: 'vk_12345', rawId: 12345 });
});

test('production without secret uses stable guest_vk id from launch params', () => {
  const identity = resolvePlayerIdentity({
    launchParams: '?vk_user_id=777&vk_app_id=54720415&sign=not-verified',
    clientId: 'spoofed',
    secret: '',
    nodeEnv: 'production',
    socketId: 'sock1'
  });
  assert.deepEqual(identity, { id: 'guest_vk_777', rawId: 777, verified: false });
});

test('production without launch params uses socket guest id', () => {
  const identity = resolvePlayerIdentity({
    launchParams: '',
    clientId: 'spoofed',
    secret: '',
    nodeEnv: 'production',
    socketId: 'sock9'
  });
  assert.equal(identity.id, 'guest_sock9');
});

test('invalid signature is rejected when secret is set', () => {
  const identity = resolvePlayerIdentity({
    launchParams: signedLaunchParams('test-secret'),
    clientId: 'x',
    secret: 'other-secret',
    nodeEnv: 'production',
    socketId: 'sock'
  });
  assert.equal(identity.error, 'Неверная подпись VK');
});

test('rebind restores a player socket after disconnect', () => {
  const io = { to: () => ({ emit() {} }) };
  const rooms = new RoomManager(io);
  const room = rooms.createRoom({ maxPlayers: 4 }, { id: 'host', socketId: 's1' });
  assert.equal(rooms.rebindPlayer('host', 's2').id, room.id);
  assert.equal(room.game.players[0].socketId, 's2');
  assert.equal(rooms.playerRooms.get('s2'), room.id);
});
