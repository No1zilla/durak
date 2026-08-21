/**
 * RoomManager.js - Room matchmaking with auto-bot filler for fast gameplay and bot AI
 */

const { DurakGame, GAME_MODES, GAME_STATES } = require('./DurakGame');

class RoomManager {
  constructor(io, hooks = {}) {
    this.io = io;
    this.rooms = new Map();
    this.playerRooms = new Map();
    this.onMatchStart = hooks.onMatchStart || (() => {});
    this.onGameOver = hooks.onGameOver || (() => {});
  }

  createRoom(settings = {}, hostPlayer) {
    const roomId = 'room_' + Math.random().toString(36).substring(2, 8);
    const maxPlayers = Math.min(6, Math.max(2, settings.maxPlayers || 4));

    const game = new DurakGame({
      id: roomId,
      mode: settings.mode || GAME_MODES.PODKIDNOY,
      deckSize: settings.deckSize || 36,
      maxPlayers,
      bet: settings.bet || 100,
      turnTimeLimit: settings.turnTimeLimit || 30,
      onTurnTimeout: () => {
        this.broadcastState(roomId);
        this.handleBotTurns(roomId);
      }
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
    if (room.game.state !== GAME_STATES.WAITING) {
      return { success: false, error: 'Игра уже началась' };
    }

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

    if (room.game.players.length >= room.game.maxPlayers && room.game.state === GAME_STATES.WAITING) {
      this.startMatch(room);
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

    const humanPlayers = room.game.players.filter(p => !p.isBot);
    if (humanPlayers.length === 0) {
      this.rooms.delete(roomId);
    } else {
      if (room.hostId === playerId) room.hostId = humanPlayers[0].id;
      this.broadcastState(roomId);
    }
  }

  quickMatch(player, preferredMode = GAME_MODES.PODKIDNOY) {
    // 1. Check for open room
    for (const [id, r] of this.rooms.entries()) {
      if (!r.isPrivate && r.game.state === GAME_STATES.WAITING && r.game.players.length < r.game.maxPlayers) {
        if (r.game.mode === preferredMode) {
          const joined = this.joinRoom(id, player);
          if (joined.success) return joined;
        }
      }
    }

    // 2. Create new room & Auto-fill with 3 AI players for instant 4-player action
    const room = this.createRoom({
      mode: preferredMode,
      maxPlayers: 4,
      bet: 250,
      turnTimeLimit: 30
    }, player);

    // Auto add 3 bots
    this.addBot(room.id, 'Екатерина (Бот)', 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&h=100&fit=crop');
    this.addBot(room.id, 'Максим (Бот)', 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100&h=100&fit=crop');
    this.addBot(room.id, 'Ольга (Бот)', 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=100&h=100&fit=crop');

    if (room.game.state === GAME_STATES.WAITING) {
      this.startMatch(room);
    }

    this.broadcastState(room.id);
    setTimeout(() => this.handleBotTurns(room.id), 1500);

    return { success: true, room };
  }

  addBot(roomId, customName = null, customAvatar = null) {
    const room = this.rooms.get(roomId);
    if (!room) return false;
    if (room.game.state !== GAME_STATES.WAITING) return false;
    if (room.game.players.length >= room.game.maxPlayers) return false;

    const botNames = ['Алексей (Бот)', 'Екатерина (Бот)', 'Максим (Бот)', 'Ольга (Бот)', 'Сергей (Бот)'];
    const botAvatars = [
      'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&h=100&fit=crop',
      'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100&h=100&fit=crop',
      'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=100&h=100&fit=crop',
      'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=100&h=100&fit=crop'
    ];

    const botId = 'bot_' + Math.random().toString(36).substring(2, 7);
    const botIndex = room.game.players.length % botNames.length;

    room.game.addPlayer({
      id: botId,
      socketId: null,
      name: customName || botNames[botIndex],
      avatar: customAvatar || botAvatars[botIndex % botAvatars.length],
      isBot: true,
      chips: 5000
    });

    if (room.game.state === GAME_STATES.WAITING && room.game.players.length >= room.game.maxPlayers) {
      this.startMatch(room);
    }

    this.broadcastState(roomId);
    this.handleBotTurns(roomId);
    return true;
  }

  startMatch(room) {
    if (!room.game.start()) return false;
    this.onMatchStart(room);
    return true;
  }

  broadcastState(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return;

    for (const player of room.game.players) {
      if (player.socketId) {
        const sanitized = room.game.getSanitizedState(player.id);
        this.io.to(player.socketId).emit('gameState', sanitized);
      }
    }
    if (room.game.state === GAME_STATES.GAME_OVER && !room.settled) {
      room.settled = true;
      this.onGameOver(room);
    }
  }

  handleBotTurns(roomId) {
    const room = this.rooms.get(roomId);
    if (!room || room.game.state === GAME_STATES.GAME_OVER || room.game.state === GAME_STATES.WAITING) return;

    const activeDefender = room.game.currentDefender;
    const activeAttacker = room.game.currentAttacker;

    setTimeout(() => {
      if (!this.rooms.has(roomId)) return;

      if (room.game.state === GAME_STATES.ATTACKING) {
        if (activeAttacker && activeAttacker.isBot && activeAttacker.outRank === null) {
          this.executeBotAttack(room, activeAttacker);
        } else {
          const botAttackers = room.game.getActivePlayers().filter(p => p.isBot && p.id !== activeDefender.id);
          if (botAttackers.length > 0 && room.game.tablePairs.length > 0) {
            this.executeBotToss(room, botAttackers[0]);
          }
        }
      } else if (room.game.state === GAME_STATES.DEFENDING) {
        if (activeDefender && activeDefender.isBot && activeDefender.outRank === null) {
          this.executeBotDefense(room, activeDefender);
        }
      }
    }, 1000);
  }

  executeBotAttack(room, bot) {
    if (room.game.tablePairs.length === 0) {
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
      room.game.pass(bot.id);
      this.broadcastState(room.id);
      this.handleBotTurns(room.id);
    }
  }

  executeBotDefense(room, bot) {
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

    const undefended = room.game.tablePairs.find(p => p.defense === null);
    if (!undefended) return;

    const validCards = bot.hand.filter(c => room.game.canBeat(undefended.attack, c));
    if (validCards.length > 0) {
      const nonTrumpBeat = validCards.filter(c => c.suit !== room.game.trumpSuit).sort((a, b) => a.rank - b.rank);
      const chosen = nonTrumpBeat.length > 0 ? nonTrumpBeat[0] : validCards.sort((a, b) => a.rank - b.rank)[0];

      room.game.defend(bot.id, undefended.attack.id, chosen.id);
      this.broadcastState(room.id);
      this.handleBotTurns(room.id);
    } else {
      room.game.take(bot.id);
      this.broadcastState(room.id);
      this.handleBotTurns(room.id);
    }
  }
}

module.exports = { RoomManager };
