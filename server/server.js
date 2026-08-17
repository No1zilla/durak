/**
 * server.js - Real-Time Game Server for Durak Online 3D (VK Mini App)
 */

const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const { RoomManager } = require('./gameEngine/RoomManager');
const { EconomyService, SKINS_CATALOG } = require('./services/economyService');
const { resolvePlayerIdentity, cleanText, cleanImageUrl } = require('./security');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const VK_APP_ID = process.env.VK_APP_ID || '54720415';
const BUILD_SHA = process.env.RAILWAY_GIT_COMMIT_SHA || process.env.GIT_COMMIT_SHA || 'dev';

const DISCONNECT_GRACE_MS = 10000;
const pendingLeaves = new Map();

// Middlewares
app.use(express.json());
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader(
    'Content-Security-Policy',
    "frame-ancestors 'self' https://vk.com https://*.vk.com https://vk.ru https://*.vk.ru https://*.vk.me"
  );
  next();
});
app.use(express.static(path.join(__dirname, '../client'), {
  setHeaders(res, filePath) {
    res.setHeader('Cache-Control', /\.(?:html|js|css)$/.test(filePath)
      ? 'no-cache'
      : 'public, max-age=86400');
  }
}));

// Services
const roomManager = new RoomManager(io);
const economyService = new EconomyService();

// REST API Endpoints
app.get('/api/config', (req, res) => {
  res.json({
    vkAppId: VK_APP_ID,
    serverTime: Date.now(),
    version: '1.0.0',
    buildSha: BUILD_SHA
  });
});

app.get('/api/shop/catalog', (req, res) => {
  res.json(SKINS_CATALOG);
});

app.post('/api/vkpay/order', (req, res) => {
  res.status(410).json({ success: false, error: 'Покупка ожидает серверного подтверждения VK Pay' });
});

// Socket.io Real-time Event Handlers
io.on('connection', (socket) => {
  let currentPlayer = null;
  let actionWindowStart = Date.now();
  let actionCount = 0;

  const reject = (message) => {
    socket.emit('errorMsg', message);
    return null;
  };

  const roomForAction = (roomId, { host = false, waiting = false } = {}) => {
    if (!currentPlayer) return reject('Требуется авторизация');
    const room = roomManager.getRoom(roomId);
    if (!room) return reject('Стол не найден');
    if (roomManager.playerRooms.get(currentPlayer.id) !== roomId) return reject('Вы не участник этого стола');
    if (host && room.hostId !== currentPlayer.id) return reject('Действие доступно только владельцу стола');
    if (waiting && room.game.state !== 'WAITING') return reject('Игра уже началась');

    const now = Date.now();
    if (now - actionWindowStart >= 1000) {
      actionWindowStart = now;
      actionCount = 0;
    }
    if (++actionCount > 30) return reject('Слишком много действий');
    return room;
  };

  const emitAuth = () => {
    socket.emit('authSuccess', {
      player: currentPlayer,
      userEconomy: economyService.getUser(currentPlayer.id)
    });
    socket.emit('roomList', roomManager.getRoomList());
  };

  socket.on('auth', (playerData) => {
    if (currentPlayer) return reject('Сессия уже авторизована');
    const identity = resolvePlayerIdentity({
      launchParams: playerData?.launchParams,
      clientId: playerData?.id,
      secret: process.env.VK_CLIENT_SECRET,
      nodeEnv: process.env.NODE_ENV,
      socketId: socket.id
    });
    if (identity.error) {
      reject(identity.error);
      return;
    }

    const pending = pendingLeaves.get(identity.id);
    if (pending) {
      clearTimeout(pending);
      pendingLeaves.delete(identity.id);
    }

    currentPlayer = {
      id: identity.id,
      socketId: socket.id,
      name: cleanText(playerData?.name, 'Гость'),
      avatar: cleanImageUrl(playerData?.avatar, ''),
      chips: 5000,
      activeTable: 'table_emerald',
      activeDeck: 'deck_classic',
      verified: !!identity.verified
    };

    const existingRoom = roomManager.rebindPlayer(identity.id, socket.id);
    if (existingRoom) {
      socket.join(existingRoom.id);
      emitAuth();
      socket.emit('joinedRoom', { roomId: existingRoom.id, isHost: existingRoom.hostId === identity.id });
      roomManager.broadcastState(existingRoom.id);
      return;
    }

    emitAuth();
  });

  socket.on('getRooms', () => {
    socket.emit('roomList', roomManager.getRoomList());
  });

  socket.on('createRoom', (settings = {}) => {
    if (!currentPlayer) return;
    if (roomManager.playerRooms.has(currentPlayer.id)) return reject('Сначала выйдите из текущего стола');
    const room = roomManager.createRoom({
      mode: settings?.mode === 'perevodnoy' ? 'perevodnoy' : 'podkidnoy',
      deckSize: [24, 36, 52].includes(Number(settings?.deckSize)) ? Number(settings.deckSize) : 36,
      maxPlayers: Math.min(6, Math.max(2, Number(settings?.maxPlayers) || 4)),
      bet: [100, 500, 1000, 5000].includes(Number(settings?.bet)) ? Number(settings.bet) : 100,
      name: cleanText(settings?.name, '', 50)
    }, currentPlayer);
    socket.join(room.id);
    socket.emit('joinedRoom', { roomId: room.id, isHost: true });
    roomManager.broadcastState(room.id);
    io.emit('roomList', roomManager.getRoomList());
  });

  socket.on('joinRoom', ({ roomId, password } = {}) => {
    if (!currentPlayer) return;
    if (roomManager.playerRooms.has(currentPlayer.id)) return reject('Сначала выйдите из текущего стола');
    const res = roomManager.joinRoom(roomId, currentPlayer, password);
    if (res.success) {
      socket.join(roomId);
      socket.emit('joinedRoom', { roomId, isHost: false });
      roomManager.broadcastState(roomId);
      io.emit('roomList', roomManager.getRoomList());
    } else {
      socket.emit('errorMsg', res.error);
    }
  });

  socket.on('quickMatch', ({ mode } = {}) => {
    if (!currentPlayer) return;
    if (roomManager.playerRooms.has(currentPlayer.id)) return reject('Сначала выйдите из текущего стола');
    const res = roomManager.quickMatch(currentPlayer, mode === 'perevodnoy' ? 'perevodnoy' : 'podkidnoy');
    if (res.success) {
      socket.join(res.room.id);
      socket.emit('joinedRoom', { roomId: res.room.id, isHost: res.room.hostId === currentPlayer.id });
      roomManager.broadcastState(res.room.id);
      io.emit('roomList', roomManager.getRoomList());
    }
  });

  socket.on('leaveRoom', () => {
    if (!currentPlayer) return;
    const roomId = roomManager.playerRooms.get(currentPlayer.id);
    if (roomId) {
      socket.leave(roomId);
      roomManager.leaveRoom(currentPlayer.id, socket.id);
      socket.emit('leftRoom');
      io.emit('roomList', roomManager.getRoomList());
    }
  });

  socket.on('addBot', ({ roomId } = {}) => {
    const room = roomForAction(roomId, { host: true, waiting: true });
    if (!room) return;
    const success = roomManager.addBot(roomId);
    if (success) {
      io.emit('roomList', roomManager.getRoomList());
    }
  });

  socket.on('startGame', ({ roomId } = {}) => {
    const room = roomForAction(roomId, { host: true, waiting: true });
    if (!room) return;
    if (room.game.players.length < 2) return reject('Нужно минимум два игрока');
    room.game.start();
    roomManager.broadcastState(roomId);
    io.emit('roomList', roomManager.getRoomList());
    roomManager.handleBotTurns(roomId);
  });

  // Game Action Handlers
  socket.on('attack', ({ roomId, cardId } = {}) => {
    const room = roomForAction(roomId);
    if (!room) return;

    const res = room.game.attack(currentPlayer.id, cardId);
    if (res.success) {
      roomManager.broadcastState(roomId);
      roomManager.handleBotTurns(roomId);
    } else {
      socket.emit('errorMsg', res.error);
    }
  });

  socket.on('transfer', ({ roomId, cardId } = {}) => {
    const room = roomForAction(roomId);
    if (!room) return;

    const res = room.game.transfer(currentPlayer.id, cardId);
    if (res.success) {
      roomManager.broadcastState(roomId);
      roomManager.handleBotTurns(roomId);
    } else {
      socket.emit('errorMsg', res.error);
    }
  });

  socket.on('defend', ({ roomId, attackCardId, defendCardId } = {}) => {
    const room = roomForAction(roomId);
    if (!room) return;

    const res = room.game.defend(currentPlayer.id, attackCardId, defendCardId);
    if (res.success) {
      roomManager.broadcastState(roomId);
      roomManager.handleBotTurns(roomId);
    } else {
      socket.emit('errorMsg', res.error);
    }
  });

  socket.on('pass', ({ roomId } = {}) => {
    const room = roomForAction(roomId);
    if (!room) return;

    const res = room.game.pass(currentPlayer.id);
    if (res.success) {
      roomManager.broadcastState(roomId);
      roomManager.handleBotTurns(roomId);
    }
  });

  socket.on('take', ({ roomId } = {}) => {
    const room = roomForAction(roomId);
    if (!room) return;

    const res = room.game.take(currentPlayer.id);
    if (res.success) {
      roomManager.broadcastState(roomId);
      roomManager.handleBotTurns(roomId);
    }
  });

  // Interactive 3D Item Throwing (Tomato, Champagne, Coin)
  socket.on('throwItem', ({ roomId, targetPlayerId, itemType } = {}) => {
    const room = roomForAction(roomId);
    if (!room || !room.game.players.some(p => p.id === targetPlayerId)) return;
    const safeItem = ['tomato', 'champagne', 'coin', 'fire', 'heart'].includes(itemType) ? itemType : 'tomato';
    io.to(roomId).emit('itemThrown', {
      fromPlayerId: currentPlayer.id,
      targetPlayerId,
      itemType: safeItem
    });
  });

  // 3D Emoji Reaction
  socket.on('chatReaction', ({ roomId, emoji } = {}) => {
    if (!roomForAction(roomId)) return;
    const safeEmoji = ['👍', '👏', '😂', '😮', '😢', '🔥'].includes(emoji) ? emoji : null;
    if (!safeEmoji) return;
    io.to(roomId).emit('playerReaction', {
      playerId: currentPlayer.id,
      emoji: safeEmoji
    });
  });

  // Economy & Shop
  socket.on('claimDailyBonus', () => {
    if (!currentPlayer) return;
    const res = economyService.claimDailyReward(currentPlayer.id);
    socket.emit('dailyBonusResult', res);
  });

  socket.on('buySkin', ({ category, skinId, useCurrency } = {}) => {
    if (!currentPlayer) return;
    const res = economyService.buySkin(currentPlayer.id, category, skinId, useCurrency);
    socket.emit('buySkinResult', res);
  });

  socket.on('equipSkin', ({ category, skinId } = {}) => {
    if (!currentPlayer) return;
    const res = economyService.equipSkin(currentPlayer.id, category, skinId);
    socket.emit('equipSkinResult', res);
  });

  socket.on('disconnect', () => {
    if (!currentPlayer) return;
    const playerId = currentPlayer.id;
    const socketId = socket.id;
    const previous = pendingLeaves.get(playerId);
    if (previous) clearTimeout(previous);
    pendingLeaves.set(playerId, setTimeout(() => {
      pendingLeaves.delete(playerId);
      roomManager.leaveRoom(playerId, socketId);
      io.emit('roomList', roomManager.getRoomList());
    }, DISCONNECT_GRACE_MS));
  });
});

server.listen(PORT, () => {
  console.log(`===========================================`);
  console.log(`🃏 AAA+++ Durak Online 3D Server running!`);
  console.log(`🌐 Port: ${PORT}`);
  console.log(`🆔 VK App ID: ${VK_APP_ID}`);
  console.log(`===========================================`);
});
