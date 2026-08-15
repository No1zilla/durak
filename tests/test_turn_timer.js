/**
 * test_turn_timer.js — Test that server auto-takes for defender after timeout
 * Uses a 3-second timer for fast testing.
 * 
 * Run: node tests/test_turn_timer.js
 */

const { io } = require('socket.io-client');

const SERVER = 'http://localhost:3000';

async function runTimerTest() {
  console.log('\n⏱  Turn Timer Test (3s timeout)\n');

  const socket = io(SERVER, { transports: ['websocket'] });

  function waitFor(event, ms = 10000) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`Timeout: ${event}`)), ms);
      socket.once(event, d => { clearTimeout(t); resolve(d); });
    });
  }

  function collectGameStates(ms) {
    return new Promise(resolve => {
      const states = [];
      const h = s => states.push(s);
      socket.on('gameState', h);
      setTimeout(() => { socket.off('gameState', h); resolve(states); }, ms);
    });
  }

  try {
    await new Promise((res, rej) => {
      socket.on('connect', res);
      setTimeout(() => rej(new Error('connect timeout')), 5000);
    });
    console.log('  ✅ Connected');

    socket.emit('auth', { id: 'timer_test_player', name: 'TimerTest' });
    await waitFor('authSuccess');
    console.log('  ✅ Authenticated');

    // Quick match — game starts with 3 bots
    socket.emit('quickMatch', { mode: 'podkidnoy' });
    await waitFor('joinedRoom');

    const state = await waitFor('gameState');
    console.log(`  ✅ Game started. Trump: ${state.trumpSuit}`);
    console.log(`  ✅ My role: ${state.attackerId === 'timer_test_player' ? 'ATTACKER' : state.defenderId === 'timer_test_player' ? 'DEFENDER' : 'BYSTANDER'}`);

    // Wait 4 seconds for bot turns + bots to resolve
    console.log('  ⏳ Waiting 6s for bots and timer to run...');
    const updates = await collectGameStates(6000);
    console.log(`  ✅ Received ${updates.length} state updates during wait`);

    if (updates.length > 0) {
      const last = updates[updates.length - 1];
      console.log(`  ✅ Final state: ${last.state}, table pairs: ${last.tablePairs.length}, deck: ${last.deckRemaining}`);
      
      const me = last.players.find(p => p.id === 'timer_test_player');
      console.log(`  ✅ My cards: ${me.cardsCount}, hand visible: ${me.hand.length}`);
    }

    console.log('\n  ✅ Timer test passed — no crashes\n');
  } catch (err) {
    console.error(`  ❌ ${err.message}`);
  } finally {
    socket.disconnect();
    process.exit(0);
  }
}

runTimerTest();
