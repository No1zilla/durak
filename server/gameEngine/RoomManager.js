/**
 * RoomManager.js - Room matchmaking, bot management, and broadcast controller
 */

const { DurakGame, GAME_MODES, GAME_STATES } = require('./DurakGame');

class RoomManager {
  constructor(io) {
    this.io = io;
    this.rooms = new Map(); // roomId -> { game, settings, hostId, spectators: [] }
    this.playerRooms = new Map(); // socketId/playerId -> roomId
  }

  createRoom(settings = {}, hostPlayer) {
    const roomId = 'room_' + Math.random().toString(36).substring(2, 8);
    const game = new DurakGame({
      id: roomId,
      mode: settings.mode || GAME_MODES.PODKIDNOY,
      deckSize: settings.deckSize || 36,
      maxPlayers: settings.maxPlayers || 4,
      bet: settings.bet || 100,
      turnTimeLimit: settings.turnTimeLimit || 30
    });

    if (hostPlayer) {
      game.addPlayer(hostPlayer);
      this.playerRooms.set(hostPlayer.id, roomId);
      if (hostPlayer.socketId) {
        this.playerRooms.set(hostPlayer.socketId, roomId);
      }
    }

    const roomData = {
      id: roomId,
      name: settings.name || `Стол #${roomId.slice(-4)}`,
      game,
      hostId: hostPlayer ? hostPlayer.id : null,
      password: settings.password || null,
      isPrivate: !!settings.isPrivate,
      createdAt: Date.now()
    };

    this.rooms.set(roomId, roomData);
    return roomData;
  }

  getRoom(roomId) {
    return this.rooms.get(roomId);
  }

  getRoomList() {
    const list = [];
    for (const [id, r] of this.rooms.entries()) {
      if (r.isPrivate) continue;
      list.push({
        id: r.id,
        name: r.name,
        mode: r.game.mode,
        playersCount: r.game.players.length,
        maxPlayers: r.game.maxPlayers,
        bet: r.game.bet,
        state: r.game.state,
        deckSize: r.game.deckSize,
        avatars: r.game.players.map(p => p.avatar)
      });
    }
    return list;
  }

  joinRoom(roomId, player, password = null) {
    const room = this.rooms.get(roomId);
    if (!room) return { success: false, error: 'Стол не найден' };

    if (room.password && room.password !== password) {
      return { success: false, error: 'Неверный пароль' };
    }

    if (room.game.players.length >= room.game.maxPlayers) {
      return { success: false, error: 'Стол заполнен' };
    }

    const added = room.game.addPlayer(player);
    if (!added) return { success: false, error: 'Не удалось присоединиться' };

    this.playerRooms.set(player.id, roomId);
    if (player.socketId) this.playerRooms.set(player.socketId, roomId);

    // Auto-start if table reaches max players
    if (room.game.players.length === room.game.maxPlayers && room.game.state === GAME_STATES.WAITING) {
      room.game.start();
    }

    this.broadcastState(roomId);
    return { success: true, room };
  }

  leaveRoom(playerId, socketId) {
    const roomId = this.playerRooms.get(playerId) || this.playerRooms.get(socketId);
    if (!roomId) return;

    const room = this.rooms.get(roomId);
    if (!room) return;

    room.game.removePlayer(playerId);
    this.playerRooms.delete(playerId);
    if (socketId) this.playerRooms.delete(socketId);

    // If room is empty, delete room
    const humanPlayers = room.game.players.filter(p => !p.isBot);
    if (humanPlayers.length === 0) {
      this.rooms.delete(roomId);
    } else {
      this.broadcastState(roomId);
    }
  }

  quickMatch(player, preferredMode = GAME_MODES.PODKIDNOY) {
    // Find open room waiting for players
    for (const [id, r] of this.rooms.entries()) {
      if (!r.isPrivate && r.game.state === GAME_STATES.WAITING && r.game.players.length < r.game.maxPlayers) {
        if (r.game.mode === preferredMode) {
          return this.joinRoom(id, player);
        }
      }
    }

    // Create a new room with 4 players default
    const room = this.createRoom({
      mode: preferredMode,
      maxPlayers: 4,
      bet: 250,
      turnTimeLimit: 30
    }, player);

    this.broadcastState(room.id);
    return { success: true, room };
  }

  addBot(roomId) {
    const room = this.rooms.get(roomId);
    if (!room || room.game.state !== GAME_STATES.WAITING) return false;
    if (room.game.players.length >= room.game.maxPlayers) return false;

    const botNames = ['Алексей Бот', 'Екатерина Бот', 'Максим Бот', 'Ольга Бот', 'Сергей Бот'];
    const botAvatars = [
      'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&h=100&fit=crop',
      'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100&h=100&fit=crop',
      'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=100&h=100&fit=crop'
    ];

    const botId = 'bot_' + Math.random().toString(36).substring(2, 7);
    const botIndex = room.game.players.length % botNames.length;

    room.game.addPlayer({
      id: botId,
      socketId: null,
      name: botNames[botIndex],
      avatar: botAvatars[botIndex % botAvatars.length],
      isBot: true,
      chips: 5000
    });

    this.broadcastState(roomId);
    return true;
  }

  broadcastState(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return;

    // Send individualized sanitized state to each connected player
    for (const player of room.game.players) {
      if (player.socketId) {
        const sanitized = room.game.getSanitizedState(player.id);
        this.io.to(player.socketId).emit('gameState', sanitized);
      }
    }
  }

  handleBotTurns(roomId) {
    const room = this.rooms.get(roomId);
    if (!room || room.game.state === GAME_STATES.GAME_OVER || room.game.state === GAME_STATES.WAITING) return;

    const activeDefender = room.game.currentDefender;
    const activeAttacker = room.game.currentAttacker;

    // Bot AI Turn Logic
    setTimeout(() => {
      if (room.game.state === GAME_STATES.ATTACKING) {
        // Find if attacker is bot
        if (activeAttacker && activeAttacker.isBot && activeAttacker.outRank === null) {
          this.executeBotAttack(room, activeAttacker);
        } else {
          // Other bot players might toss cards
          const botAttackers = room.game.getActivePlayers().filter(p => p.isBot && p.id !== activeDefender.id);
          if (botAttackers.length > 0 && room.game.tablePairs.length > 0) {
            this.executeBotToss(room, botAttackers[0]);
          }
        }
      } else if (room.game.state === GAME_STATES.DEFENDING) {
        // Find if defender is bot
        if (activeDefender && activeDefender.isBot && activeDefender.outRank === null) {
          this.executeBotDefense(room, activeDefender);
        }
      }
    }, 1200);
  }

  executeBotAttack(room, bot) {
    if (room.game.tablePairs.length === 0) {
      // Lead attack with lowest non-trump card
      const nonTrumps = bot.hand.filter(c => c.suit !== room.game.trumpSuit).sort((a, b) => a.rank - b.rank);
      const cardToPlay = nonTrumps.length > 0 ? nonTrumps[0] : bot.hand.sort((a, b) => a.rank - b.rank)[0];

      if (cardToPlay) {
        room.game.attack(bot.id, cardToPlay.id);
        this.broadcastState(room.id);
        this.handleBotTurns(room.id);
      }
    } else {
      this.executeBotToss(room, bot);
    }
  }

  executeBotToss(room, bot) {
    const allowedRanks = new Set(room.game.tablePairs.flatMap(p => [p.attack.rank, p.defense ? p.defense.rank : null]).filter(Boolean));
    const matching = bot.hand.filter(c => allowedRanks.has(c.rank) && c.suit !== room.game.trumpSuit);

    if (matching.length > 0 && room.game.tablePairs.length < 6) {
      room.game.attack(bot.id, matching[0].id);
      this.broadcastState(room.id);
      this.handleBotTurns(room.id);
    } else {
      // Pass
      room.game.pass(bot.id);
      this.broadcastState(room.id);
      this.handleBotTurns(room.id);
    }
  }

  executeBotDefense(room, bot) {
    // In Perevodnoy, check if bot can transfer
    if (room.game.mode === GAME_MODES.PEREVODNOY && room.game.tablePairs.every(p => !p.defense)) {
      const targetRank = room.game.tablePairs[0].attack.rank;
      const transferCard = bot.hand.find(c => c.rank === targetRank);
      if (transferCard) {
        const res = room.game.transfer(bot.id, transferCard.id);
        if (res.success) {
          this.broadcastState(room.id);
          this.handleBotTurns(room.id);
          return;
        }
      }
    }

    // Try to defend undefended pairs
    const undefended = room.game.tablePairs.find(p => p.defense === null);
    if (!undefended) return;

    // Find best card to beat (lowest valid non-trump, or lowest valid trump)
    const validCards = bot.hand.filter(c => room.game.canBeat(undefended.attack, c));
    if (validCards.length > 0) {
      // Prefer non-trump beat
      const nonTrumpBeat = validCards.filter(c => c.suit !== room.game.trumpSuit).sort((a, b) => a.rank - b.rank);
      const chosen = nonTrumpBeat.length > 0 ? nonTrumpBeat[0] : validCards.sort((a, b) => a.rank - b.rank)[0];

      room.game.defend(bot.id, undefended.attack.id, chosen.id);
      this.broadcastState(room.id);
      this.handleBotTurns(room.id);
    } else {
      // Take
      room.game.take(bot.id);
      this.broadcastState(room.id);
      this.handleBotTurns(room.id);
    }
  }
}

module.exports = { RoomManager };
