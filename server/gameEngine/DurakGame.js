/**
 * DurakGame.js - Complete state machine for Подкидной & Переводной Дурак (2-6 players)
 */

const { Deck } = require('./Deck');

const GAME_MODES = {
  PODKIDNOY: 'podkidnoy',
  PEREVODNOY: 'perevodnoy'
};

const GAME_STATES = {
  WAITING: 'WAITING',
  DEALING: 'DEALING',
  ATTACKING: 'ATTACKING',
  DEFENDING: 'DEFENDING',
  RESOLVING: 'RESOLVING',
  ROUND_END: 'ROUND_END',
  GAME_OVER: 'GAME_OVER'
};

class DurakGame {
  constructor(options = {}) {
    this.id = options.id || Math.random().toString(36).substring(2, 9);
    this.mode = options.mode || GAME_MODES.PODKIDNOY; // 'podkidnoy' | 'perevodnoy'
    this.deckSize = options.deckSize || 36; // 24, 36, 52
    this.maxPlayers = Math.min(6, Math.max(2, options.maxPlayers || 4));
    this.bet = options.bet || 100;
    this.turnTimeLimit = options.turnTimeLimit || 30; // seconds

    this.players = []; // Array of { id, socketId, name, avatar, hand: [], isBot, isReady, outRank: null }
    this.deck = null;
    this.trumpCard = null;
    this.trumpSuit = null;
    this.discardPile = []; // Бита (сброс)
    this.tablePairs = []; // [{ attack: Card, defense: Card | null, attackerId: string, defenderId: string }]

    this.attackerIndex = 0;
    this.defenderIndex = 1;
    this.turnStartTime = null;
    this.timer = null;
    this.passedPlayerIds = new Set();
    this.isFirstBita = true; // First bout maximum 5 cards rule
    this.state = GAME_STATES.WAITING;
    this.winners = []; // Ordered list of players who finished
    this.durak = null; // The loser

    this.history = []; // Event log for match breakdown
    this.onStateChange = options.onStateChange || (() => {});
  }

  addPlayer(player) {
    if (this.players.length >= this.maxPlayers) return false;
    if (this.players.some(p => p.id === player.id)) return false;

    this.players.push({
      id: player.id,
      socketId: player.socketId,
      name: player.name || `Игрок ${this.players.length + 1}`,
      avatar: player.avatar || '',
      hand: [],
      isBot: !!player.isBot,
      isReady: true,
      outRank: null,
      chips: player.chips || 1000
    });

    return true;
  }

  removePlayer(playerId) {
    const idx = this.players.findIndex(p => p.id === playerId);
    if (idx === -1) return false;

    if (this.state === GAME_STATES.WAITING) {
      this.players.splice(idx, 1);
      return true;
    } else {
      // In active game, convert player to Bot or auto-surrender
      const player = this.players[idx];
      player.isBot = true;
      player.socketId = null;
      return true;
    }
  }

  start() {
    if (this.players.length < 2) return false;

    this.state = GAME_STATES.DEALING;
    this.deck = new Deck(this.deckSize);
    this.trumpCard = this.deck.trumpCard;
    this.trumpSuit = this.deck.trumpSuit;
    this.discardPile = [];
    this.tablePairs = [];
    this.passedPlayerIds.clear();
    this.winners = [];
    this.durak = null;
    this.isFirstBita = true;

    // Deal 6 cards to each player
    for (const player of this.players) {
      player.hand = this.deck.draw(6);
      player.outRank = null;
    }

    // Determine first attacker (lowest trump in hand)
    this.determineFirstAttacker();

    this.state = GAME_STATES.ATTACKING;
    this.turnStartTime = Date.now();
    this.log(`Игра началась! Козырь: ${this.trumpSuit.toUpperCase()}`);
    return true;
  }

  determineFirstAttacker() {
    let lowestTrumpRank = 999;
    let starterIndex = 0;

    for (let i = 0; i < this.players.length; i++) {
      const trumps = this.players[i].hand.filter(c => c.suit === this.trumpSuit);
      for (const t of trumps) {
        if (t.rank < lowestTrumpRank) {
          lowestTrumpRank = t.rank;
          starterIndex = i;
        }
      }
    }

    this.attackerIndex = starterIndex;
    this.defenderIndex = this.getNextActivePlayerIndex(starterIndex);
  }

  getActivePlayers() {
    return this.players.filter(p => p.outRank === null);
  }

  getNextActivePlayerIndex(currentIndex) {
    let idx = (currentIndex + 1) % this.players.length;
    let attempts = 0;
    while (this.players[idx].outRank !== null && attempts < this.players.length) {
      idx = (idx + 1) % this.players.length;
      attempts++;
    }
    return idx;
  }

  get currentAttacker() {
    return this.players[this.attackerIndex];
  }

  get currentDefender() {
    return this.players[this.defenderIndex];
  }

  /**
   * Attack Action: Player places a card on the table
   */
  attack(playerId, cardId) {
    const player = this.players.find(p => p.id === playerId);
    if (!player || player.outRank !== null) return { success: false, error: 'Игрок не активен' };

    const defender = this.currentDefender;
    if (!defender) return { success: false, error: 'Защитник не найден' };
    if (player.id === defender.id) return { success: false, error: 'Защитник не может атаковать сам себя' };

    // Maximum cards in round check
    const maxAllowedCards = this.isFirstBita ? 5 : 6;
    const undefendedCount = this.tablePairs.filter(p => !p.defense).length;
    const remainingDefenderHand = defender.hand.length - undefendedCount;

    if (remainingDefenderHand <= 0) {
      return { success: false, error: 'У защитника недостаточно карт для отбоя' };
    }
    if (this.tablePairs.length >= maxAllowedCards) {
      return { success: false, error: `Достигнут лимит карт (${maxAllowedCards})` };
    }

    const cardIndex = player.hand.findIndex(c => c.id === cardId);
    if (cardIndex === -1) return { success: false, error: 'Карта не найдена в руке' };
    const card = player.hand[cardIndex];

    // If cards already on table, rank must match any card on table
    if (this.tablePairs.length > 0) {
      const allowedRanks = new Set();
      for (const pair of this.tablePairs) {
        allowedRanks.add(pair.attack.rank);
        if (pair.defense) allowedRanks.add(pair.defense.rank);
      }
      if (!allowedRanks.has(card.rank)) {
        return { success: false, error: 'Номинал карты не совпадает с картами на столе' };
      }
    }

    // Place card on table
    player.hand.splice(cardIndex, 1);
    this.tablePairs.push({
      attack: card,
      defense: null,
      attackerId: player.id,
      defenderId: defender.id
    });

    this.passedPlayerIds.clear();
    this.state = GAME_STATES.DEFENDING;
    this.turnStartTime = Date.now();
    this.log(`${player.name} ходит картой ${card.label}${card.symbol}`);

    return { success: true, card, pairIndex: this.tablePairs.length - 1 };
  }

  /**
   * Transfer Action (Перевод): Defender transfers attack to next player by matching rank
   */
  transfer(playerId, cardId) {
    if (this.mode !== GAME_MODES.PEREVODNOY) {
      return { success: false, error: 'Стол не в режиме Переводного' };
    }

    const defender = this.currentDefender;
    if (!defender || defender.id !== playerId) {
      return { success: false, error: 'Только защитник может перевести ход' };
    }

    // Cannot transfer if defender has already defended any card
    const hasDefended = this.tablePairs.some(p => p.defense !== null);
    if (hasDefended) {
      return { success: false, error: 'Нельзя перевести: уже есть побитые карты' };
    }

    const cardIndex = defender.hand.findIndex(c => c.id === cardId);
    if (cardIndex === -1) return { success: false, error: 'Карта не найдена' };
    const card = defender.hand[cardIndex];

    // Card rank must match attack cards on table
    if (this.tablePairs.length > 0 && this.tablePairs[0].attack.rank !== card.rank) {
      return { success: false, error: 'Номинал для перевода должен совпадать' };
    }

    // Check if next player has enough cards in hand to defend all cards
    const nextDefenderIndex = this.getNextActivePlayerIndex(this.defenderIndex);
    const nextDefender = this.players[nextDefenderIndex];
    const totalAttackingCards = this.tablePairs.length + 1;

    if (nextDefender.hand.length < totalAttackingCards) {
      return { success: false, error: `У следующего игрока (${nextDefender.name}) недостаточно карт для перевода` };
    }

    // Execute transfer
    defender.hand.splice(cardIndex, 1);
    this.tablePairs.push({
      attack: card,
      defense: null,
      attackerId: defender.id,
      defenderId: nextDefender.id
    });

    // Update roles
    this.attackerIndex = this.defenderIndex;
    this.defenderIndex = nextDefenderIndex;
    this.passedPlayerIds.clear();
    this.turnStartTime = Date.now();

    this.log(`${defender.name} переводит ход на ${nextDefender.name} картой ${card.label}${card.symbol}!`);
    return { success: true, card, newDefenderId: nextDefender.id };
  }

  /**
   * Defend Action: Defender beats a specific attacking card
   */
  defend(playerId, attackCardId, defendCardId) {
    const defender = this.currentDefender;
    if (!defender || defender.id !== playerId) {
      return { success: false, error: 'Только защитник может отбивать' };
    }

    const pair = this.tablePairs.find(p => p.attack.id === attackCardId);
    if (!pair) return { success: false, error: 'Атакующая карта не найдена' };
    if (pair.defense) return { success: false, error: 'Эта карта уже отбита' };

    const cardIndex = defender.hand.findIndex(c => c.id === defendCardId);
    if (cardIndex === -1) return { success: false, error: 'Карта защиты не найдена' };
    const defendCard = defender.hand[cardIndex];

    // Validate if defendCard can beat attackCard
    if (!this.canBeat(pair.attack, defendCard)) {
      return { success: false, error: 'Эта карта не может побить атакующую' };
    }

    defender.hand.splice(cardIndex, 1);
    pair.defense = defendCard;
    this.turnStartTime = Date.now();

    this.log(`${defender.name} бьёт ${pair.attack.label}${pair.attack.symbol} картой ${defendCard.label}${defendCard.symbol}`);

    // Check if all cards on table are defended
    const allDefended = this.tablePairs.every(p => p.defense !== null);
    if (allDefended) {
      this.state = GAME_STATES.ATTACKING;
    }

    return { success: true, attackCardId, defendCard };
  }

  canBeat(attackCard, defendCard) {
    // If suits match, higher rank wins
    if (attackCard.suit === defendCard.suit) {
      return defendCard.rank > attackCard.rank;
    }
    // If defender uses trump against non-trump, wins
    if (defendCard.suit === this.trumpSuit && attackCard.suit !== this.trumpSuit) {
      return true;
    }
    return false;
  }

  /**
   * Pass Action (Бита / Готово): Attacker has no more cards to toss
   */
  pass(playerId) {
    const player = this.players.find(p => p.id === playerId);
    if (!player || player.outRank !== null) return { success: false };

    // Defender cannot pass
    if (player.id === this.currentDefender.id) return { success: false };

    this.passedPlayerIds.add(playerId);

    const activeAttackers = this.getActivePlayers().filter(p => p.id !== this.currentDefender.id);
    const allPassed = activeAttackers.every(p => this.passedPlayerIds.has(p.id));
    const allDefended = this.tablePairs.length > 0 && this.tablePairs.every(p => p.defense !== null);

    if (allPassed && allDefended) {
      this.resolveBita();
      return { success: true, bita: true };
    }

    return { success: true, bita: false, passedPlayers: Array.from(this.passedPlayerIds) };
  }

  /**
   * Take Action (Взять): Defender yields and collects all cards from the table
   */
  take(playerId) {
    const defender = this.currentDefender;
    if (!defender || defender.id !== playerId) {
      return { success: false, error: 'Только защитник может забрать карты' };
    }
    if (this.tablePairs.length === 0) {
      return { success: false, error: 'На столе нет карт' };
    }

    this.log(`${defender.name} забирает карты`);

    // Collect all table cards into defender's hand
    const collectedCards = [];
    for (const pair of this.tablePairs) {
      collectedCards.push(pair.attack);
      defender.hand.push(pair.attack);
      if (pair.defense) {
        collectedCards.push(pair.defense);
        defender.hand.push(pair.defense);
      }
    }
    this.tablePairs = [];

    // Replenish hands for attackers
    this.replenishHands(false);

    // Defender skips turn to attack -> next player becomes attacker
    const nextAttackerIndex = this.getNextActivePlayerIndex(this.defenderIndex);
    this.attackerIndex = nextAttackerIndex;
    this.defenderIndex = this.getNextActivePlayerIndex(nextAttackerIndex);

    this.isFirstBita = false;
    this.passedPlayerIds.clear();
    this.checkGameCompletion();

    if (this.state !== GAME_STATES.GAME_OVER) {
      this.state = GAME_STATES.ATTACKING;
      this.turnStartTime = Date.now();
    }

    return { success: true, defenderId: defender.id, collectedCards };
  }

  resolveBita() {
    this.log('Бита! Карты уходят в сброс');

    for (const pair of this.tablePairs) {
      this.discardPile.push(pair.attack);
      if (pair.defense) this.discardPile.push(pair.defense);
    }
    this.tablePairs = [];

    // Replenish hands: Attacker first, other attackers, then defender
    this.replenishHands(true);

    // Defender successfully defended -> becomes the new attacker
    this.attackerIndex = this.defenderIndex;
    this.defenderIndex = this.getNextActivePlayerIndex(this.attackerIndex);

    this.isFirstBita = false;
    this.passedPlayerIds.clear();
    this.checkGameCompletion();

    if (this.state !== GAME_STATES.GAME_OVER) {
      this.state = GAME_STATES.ATTACKING;
      this.turnStartTime = Date.now();
    }
  }

  replenishHands(defenderReplenishes) {
    if (this.deck.remaining === 0) return;

    // Order: primary attacker, other attackers clockwise, then defender
    const drawOrder = [];
    let idx = this.attackerIndex;
    for (let i = 0; i < this.players.length; i++) {
      const p = this.players[idx];
      if (p.outRank === null && (defenderReplenishes || idx !== this.defenderIndex)) {
        drawOrder.push(p);
      }
      idx = (idx + 1) % this.players.length;
    }

    if (defenderReplenishes && !drawOrder.includes(this.currentDefender)) {
      if (this.currentDefender.outRank === null) {
        drawOrder.push(this.currentDefender);
      }
    }

    for (const p of drawOrder) {
      const needed = Math.max(0, 6 - p.hand.length);
      if (needed > 0 && this.deck.remaining > 0) {
        const drawn = this.deck.draw(needed);
        p.hand.push(...drawn);
      }
    }
  }

  checkGameCompletion() {
    // Check which active players now have 0 cards (when deck is empty)
    if (this.deck.remaining === 0) {
      for (const p of this.players) {
        if (p.outRank === null && p.hand.length === 0) {
          const rank = this.winners.length + 1;
          p.outRank = rank;
          this.winners.push(p);
          this.log(`🏆 ${p.name} выходит из игры на ${rank} месте!`);
        }
      }
    }

    const remaining = this.getActivePlayers();
    if (remaining.length === 1) {
      this.state = GAME_STATES.GAME_OVER;
      this.durak = remaining[0];
      this.durak.outRank = 'DURAK';
      this.log(`💀 Игра окончена! Дурак партии: ${this.durak.name}`);
    } else if (remaining.length === 0) {
      // Draw (Ничья)
      this.state = GAME_STATES.GAME_OVER;
      this.durak = null;
      this.log(`🤝 Игра окончена! Ничья!`);
    }
  }

  log(message) {
    this.history.push({ time: Date.now(), message });
    this.onStateChange(this);
  }

  /**
   * Anti-Cheat State Sanitizer
   * Only sends private hand cards to the specific requesting player.
   */
  getSanitizedState(forPlayerId) {
    return {
      id: this.id,
      mode: this.mode,
      state: this.state,
      bet: this.bet,
      deckRemaining: this.deck ? this.deck.remaining : this.deckSize,
      trumpCard: this.trumpCard,
      trumpSuit: this.trumpSuit,
      discardCount: this.discardPile.length,
      tablePairs: this.tablePairs,
      attackerId: this.currentAttacker ? this.currentAttacker.id : null,
      defenderId: this.currentDefender ? this.currentDefender.id : null,
      passedPlayerIds: Array.from(this.passedPlayerIds),
      turnTimeLimit: this.turnTimeLimit,
      turnStartTime: this.turnStartTime,
      isFirstBita: this.isFirstBita,
      winners: this.winners.map(w => ({ id: w.id, name: w.name, rank: w.outRank })),
      durak: this.durak ? { id: this.durak.id, name: this.durak.name } : null,
      players: this.players.map(p => ({
        id: p.id,
        name: p.name,
        avatar: p.avatar,
        cardsCount: p.hand.length,
        isBot: p.isBot,
        outRank: p.outRank,
        // Hand cards are strictly secret unless requesting player is this player
        hand: p.id === forPlayerId ? p.hand : []
      }))
    };
  }
}

module.exports = { DurakGame, GAME_MODES, GAME_STATES };
