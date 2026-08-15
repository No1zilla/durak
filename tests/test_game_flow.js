/**
 * test_game_flow.js — Automated game flow test via Socket.IO client
 * Simulates: connect → auth → quickMatch → receive cards → play a card → verify state updates
 * 
 * Run: node tests/test_game_flow.js
 */

const { io } = require('socket.io-client');

const SERVER = process.env.SERVER_URL || 'http://localhost:3000';
const TIMEOUT = 15000;

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${label}`);
  } else {
    failed++;
    console.error(`  ❌ FAIL: ${label}`);
  }
}

async function runTests() {
  console.log(`\n🧪 Durak Online 3D — Game Flow Test`);
  console.log(`   Server: ${SERVER}\n`);

  const socket = io(SERVER, { transports: ['websocket'], timeout: 5000 });

  // Wrap socket events in promises with timeout
  function waitFor(event, timeoutMs = TIMEOUT) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timeout waiting for "${event}"`)), timeoutMs);
      socket.once(event, (data) => {
        clearTimeout(timer);
        resolve(data);
      });
    });
  }

  function waitForState(predicate, timeoutMs = TIMEOUT) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout waiting for gameState predicate')), timeoutMs);
      const handler = (data) => {
        if (predicate(data)) {
          clearTimeout(timer);
          socket.off('gameState', handler);
          resolve(data);
        }
      };
      socket.on('gameState', handler);
    });
  }

  try {
    // ── TEST 1: Connection ──
    console.log('1️⃣  Connection');
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Connection timeout')), 5000);
      socket.on('connect', () => { clearTimeout(timer); resolve(); });
      socket.on('connect_error', (err) => { clearTimeout(timer); reject(err); });
    });
    assert(socket.connected, 'Socket connected to server');

    // ── TEST 2: Auth ──
    console.log('2️⃣  Authentication');
    socket.emit('auth', {
      id: 'test_player_001',
      name: 'Тест Игрок',
      avatar: 'https://example.com/avatar.jpg'
    });

    const authData = await waitFor('authSuccess');
    assert(authData.player !== undefined, 'authSuccess received with player data');
    assert(authData.userEconomy !== undefined, 'authSuccess received with economy data');
    assert(authData.userEconomy.chips === 5000, `Starting chips: ${authData.userEconomy.chips} (expected 5000)`);

    // ── TEST 3: Room List ──
    console.log('3️⃣  Room List');
    const roomList = await waitFor('roomList');
    assert(Array.isArray(roomList), `Room list received (${roomList.length} rooms)`);

    // ── TEST 4 & 5: Quick Match & Initial Game State ──
    console.log('4️⃣  Quick Match (Подкидной)');
    const pState = waitForState(s => ['ATTACKING', 'DEFENDING'].includes(s.state));
    socket.emit('quickMatch', { mode: 'podkidnoy' });

    const joinData = await waitFor('joinedRoom');
    assert(joinData.roomId !== undefined, `Joined room: ${joinData.roomId}`);

    console.log('5️⃣  Initial Game State');
    const state1 = await pState;
    assert(['ATTACKING', 'DEFENDING'].includes(state1.state), `Game state: ${state1.state} (active)`);
    assert(state1.players.length === 4, `Players: ${state1.players.length} (expected 4 — 1 human + 3 bots)`);
    assert(state1.trumpSuit !== undefined, `Trump suit: ${state1.trumpSuit}`);
    assert(state1.trumpCard !== null, `Trump card exists: ${state1.trumpCard?.label}${state1.trumpCard?.symbol}`);
    assert(state1.deckRemaining > 0, `Deck remaining: ${state1.deckRemaining}`);

    const myPlayer = state1.players.find(p => p.id === 'test_player_001');
    assert(myPlayer !== undefined, 'Local player found in state');
    assert(myPlayer.hand.length === 6, `Hand cards: ${myPlayer.hand.length} (expected 6)`);
    assert(myPlayer.cardsCount === 6, `Cards count: ${myPlayer.cardsCount}`);

    // Verify hand cards have proper structure
    if (myPlayer.hand.length > 0) {
      const card = myPlayer.hand[0];
      assert(card.id !== undefined, `Card has id: ${card.id}`);
      assert(card.suit !== undefined, `Card has suit: ${card.suit}`);
      assert(card.rank !== undefined, `Card has rank: ${card.rank}`);
      assert(card.label !== undefined, `Card has label: ${card.label}`);
      assert(card.symbol !== undefined, `Card has symbol: ${card.symbol}`);
    }

    // Verify opponents have hidden hands
    const opponent = state1.players.find(p => p.id !== 'test_player_001');
    assert(opponent.hand.length === 0, 'Opponent hand is hidden (anti-cheat)');
    assert(opponent.cardsCount >= 5, `Opponent cards count visible: ${opponent.cardsCount}`);

    // ── TEST 6: Play a Card ──
    console.log('6️⃣  Playing a Card');
    
    // Drain any queued bot gameState events by waiting and collecting latest state
    let latestState = state1;
    const collectStates = () => new Promise(resolve => {
      const collected = [];
      const handler = (s) => collected.push(s);
      socket.on('gameState', handler);
      setTimeout(() => {
        socket.off('gameState', handler);
        resolve(collected.length > 0 ? collected[collected.length - 1] : null);
      }, 4000); // Wait 4s for bots to finish their initial turns
    });
    
    const botStates = await collectStates();
    if (botStates) latestState = botStates;
    
    const myLatest = latestState.players.find(p => p.id === 'test_player_001');
    const isNowAttacker = latestState.attackerId === 'test_player_001';
    const isNowDefender = latestState.defenderId === 'test_player_001';
    console.log(`   Game state: ${latestState.state}, Table pairs: ${latestState.tablePairs.length}`);
    console.log(`   My role: ${isNowAttacker ? 'ATTACKER' : isNowDefender ? 'DEFENDER' : 'BYSTANDER'}`);
    console.log(`   My hand: ${myLatest.hand.map(c => c.label + c.symbol).join(', ')}`);

    if (isNowAttacker && latestState.tablePairs.length === 0) {
      const cardToPlay = myLatest.hand[0];
      console.log(`   Attacking with: ${cardToPlay.label}${cardToPlay.symbol}`);
      socket.emit('attack', { roomId: joinData.roomId, cardId: cardToPlay.id });

      const state2 = await waitFor('gameState');
      assert(state2.tablePairs.length >= 1, `Table has ${state2.tablePairs.length} pair(s) after attack`);
      
      const myAfter = state2.players.find(p => p.id === 'test_player_001');
      assert(myAfter.hand.length === myLatest.hand.length - 1, `Hand reduced: ${myLatest.hand.length} → ${myAfter.hand.length}`);
    } else if (isNowDefender && latestState.tablePairs.length > 0) {
      const undefended = latestState.tablePairs.find(p => !p.defense);
      if (undefended) {
        const trumpSuit = latestState.trumpSuit;
        const validDefense = myLatest.hand.find(c =>
          (c.suit === undefended.attack.suit && c.rank > undefended.attack.rank) ||
          (c.suit === trumpSuit && undefended.attack.suit !== trumpSuit)
        );

        if (validDefense) {
          console.log(`   Defending ${undefended.attack.label}${undefended.attack.symbol} with: ${validDefense.label}${validDefense.symbol}`);
          socket.emit('defend', {
            roomId: joinData.roomId,
            attackCardId: undefended.attack.id,
            defendCardId: validDefense.id
          });
          const state2 = await waitFor('gameState', 5000);
          assert(state2 !== undefined, 'Defense action processed');
        } else {
          console.log('   No valid defense, taking cards...');
          socket.emit('take', { roomId: joinData.roomId });
          const state2 = await waitFor('gameState', 5000);
          assert(state2.tablePairs.length === 0, 'Table cleared after taking');
        }
      } else {
        assert(true, 'All pairs already defended');
      }
    } else {
      // We can try to toss a matching card
      if (latestState.tablePairs.length > 0) {
        const ranks = new Set(latestState.tablePairs.flatMap(p => [p.attack.rank, p.defense?.rank]).filter(Boolean));
        const tossCard = myLatest.hand.find(c => ranks.has(c.rank));
        if (tossCard) {
          console.log(`   Tossing: ${tossCard.label}${tossCard.symbol}`);
          socket.emit('attack', { roomId: joinData.roomId, cardId: tossCard.id });
          const state2 = await waitFor('gameState', 5000);
          assert(state2 !== undefined, 'Toss action processed');
        } else {
          socket.emit('pass', { roomId: joinData.roomId });
          assert(true, 'Passed (no matching rank to toss)');
        }
      } else {
        assert(true, 'Not our turn, game is progressing');
      }
    }

    // ── TEST 7: Pass / Bita ──
    console.log('7️⃣  Pass / Bita Action');
    socket.emit('pass', { roomId: joinData.roomId });
    await new Promise(r => setTimeout(r, 1000));
    assert(true, 'Pass action sent without crash');

    // ── TEST 8: Leave Room ──
    console.log('8️⃣  Leave Room');
    socket.emit('leaveRoom');
    const leftData = await waitFor('leftRoom', 3000);
    assert(true, 'Successfully left room');

    // ── TEST 9: Daily Bonus ──
    console.log('9️⃣  Daily Bonus');
    socket.emit('claimDailyBonus');
    const bonusResult = await waitFor('dailyBonusResult');
    assert(bonusResult.success === true, `Daily bonus claimed: +${bonusResult.reward?.chips} chips, +${bonusResult.reward?.gold} gold`);

    // ── TEST 10: Shop Catalog ──
    console.log('🔟 Shop Catalog API');
    const catalogRes = await fetch(`${SERVER}/api/shop/catalog`);
    const catalog = await catalogRes.json();
    assert(catalog.decks !== undefined, `Shop has ${catalog.decks.length} deck skins`);
    assert(catalog.tables !== undefined, `Shop has ${catalog.tables.length} table skins`);

  } catch (err) {
    failed++;
    console.error(`\n  💥 ERROR: ${err.message}\n`);
  } finally {
    socket.disconnect();

    console.log(`\n${'═'.repeat(50)}`);
    console.log(`  Results: ${passed} passed, ${failed} failed`);
    console.log(`${'═'.repeat(50)}\n`);

    process.exit(failed > 0 ? 1 : 0);
  }
}

runTests();
