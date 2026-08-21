/**
 * server.js - Real-Time Game Server for Durak Online 3D (VK Mini App)
 */

const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const { RoomManager } = require('./gameEngine/RoomManager');
const { EconomyService, SKINS_CATALOG, VKPAY_SKUS, STARTER, QUESTS } = require('./services/economyService');
const { processVkNotification, publicPaymentsInfo } = require('./vkPayments');
const { verifyVkLaunchParams, cleanText, cleanImageUrl } = require('./security');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: true, methods: ['GET', 'POST'] }
});

const PORT = process.env.PORT || 3000;
const VK_APP_ID = process.env.VK_APP_ID || '54720415';
const BUILD_SHA = process.env.RAILWAY_GIT_COMMIT_SHA || process.env.GIT_COMMIT_SHA || 'dev';
const PUBLIC_ORIGIN = String(process.env.PUBLIC_ORIGIN || process.env.DURAK_PUBLIC_ORIGIN || '').replace(/\/$/, '');

app.set('trust proxy', true);

// Middlewares
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
  res.setHeader('X-Durak-Build', BUILD_SHA);
  res.setHeader(
    'Content-Security-Policy',
    "frame-ancestors 'self' https://vk.com https://*.vk.com https://vk.ru https://*.vk.ru https://*.vk.me"
  );
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
});
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(express.static(path.join(__dirname, '../client'), {
  setHeaders(res, filePath) {
    res.setHeader('Cache-Control', /\.(?:html|js|css)$/.test(filePath)
      ? 'no-cache'
      : 'public, max-age=86400');
  }
}));

// Services
const economyService = new EconomyService();
const roomManager = new RoomManager(io, {
  onMatchStart() {
    economyService.markMatchStarted();
  },
  onGameOver(room) {
    economyService.settleMatch(room);
    for (const player of room.game.players) {
      if (player.socketId && !player.isBot) {
        io.to(player.socketId).emit('economyUpdate', economyService.clientUser(player.id));
      }
    }
  }
});

const socketsByPlayer = new Map();

function trackPlayerSocket(playerId, socket) {
  let set = socketsByPlayer.get(playerId);
  if (!set) {
    set = new Set();
    socketsByPlayer.set(playerId, set);
  }
  set.add(socket.id);
}

function untrackPlayerSocket(playerId, socketId) {
  const set = socketsByPlayer.get(playerId);
  if (!set) return;
  set.delete(socketId);
  if (!set.size) socketsByPlayer.delete(playerId);
}

function pushEconomy(playerId) {
  const ids = socketsByPlayer.get(playerId);
  if (!ids || !ids.size) return;
  const payload = economyService.clientUser(playerId);
  for (const socketId of ids) {
    io.to(socketId).emit('economyUpdate', payload);
  }
}

function publicBootInfo() {
  const payments = publicPaymentsInfo();
  return {
    ok: true,
    vkAppId: VK_APP_ID,
    serverTime: Date.now(),
    version: '1.0.0',
    buildSha: BUILD_SHA,
    publicOrigin: PUBLIC_ORIGIN,
    paymentsReady: payments.votesEnabled,
    adsEnabled: true
  };
}

// REST API Endpoints
app.get('/api/health', (req, res) => {
  res.json(publicBootInfo());
});

app.get('/api/config', (req, res) => {
  res.json(publicBootInfo());
});

app.get('/api/shop/catalog', (req, res) => {
  res.json({
    ...SKINS_CATALOG,
    packs: Object.values(VKPAY_SKUS),
    starter: STARTER,
    quests: QUESTS,
    payments: publicPaymentsInfo()
  });
});

app.get('/api/metrics', (req, res) => {
  res.json(economyService.getMetrics());
});

app.post('/api/vkpay/order', (req, res) => {
  res.status(401).json({ success: false, error: 'Заказ создаётся из авторизованной сессии' });
});

app.get('/api/vkpay/notification', (req, res) => {
  res.json({
    ok: true,
    path: '/api/vkpay/notification',
    payments: publicPaymentsInfo(),
    hint: 'VK шлёт сюда POST (get_item / order_status_change). В кабинете: приложение 54720415 → Платежи → адрес уведомлений.'
  });
});

app.post('/api/vkpay/notification', (req, res) => {
  const result = processVkNotification(req.body, economyService, {
    appId: VK_APP_ID,
    photoUrl: PUBLIC_ORIGIN ? `${PUBLIC_ORIGIN}/assets/ui/chips.svg` : ''
  });
  if (result.userId) pushEconomy(result.userId);
  res.status(result.http).json(result.json);
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

  socket.on('auth', (playerData) => {
    if (currentPlayer) return reject('Сессия уже авторизована');
    const signedIdentity = verifyVkLaunchParams(playerData?.launchParams, process.env.VK_CLIENT_SECRET);
    if (playerData?.launchParams && process.env.VK_CLIENT_SECRET && !signedIdentity) {
      reject('Неверная подпись VK');
      return;
    }

    const developmentId = process.env.NODE_ENV !== 'production' && playerData?.id;
    const playerId = signedIdentity?.id || developmentId || `guest_${socket.id}`;
    if (roomManager.playerRooms.has(playerId)) return reject('Игрок уже находится за столом');
    currentPlayer = {
      id: playerId,
      socketId: socket.id,
      name: cleanText(playerData?.name, 'Гость'),
      avatar: cleanImageUrl(playerData?.avatar, ''),
      chips: 5000,
      activeTable: 'table_emerald',
      activeDeck: 'deck_classic'
    };

    trackPlayerSocket(playerId, socket);

    socket.emit('authSuccess', {
      player: currentPlayer,
      userEconomy: economyService.touchSession(currentPlayer.id)
    });

    // Send room list
    socket.emit('roomList', roomManager.getRoomList());
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
    if (!roomManager.startMatch(room)) return reject('Не удалось начать игру');
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
    socket.emit('dailyBonusResult', economyService.claimDailyReward(currentPlayer.id));
  });

  socket.on('claimRewarded', ({ watched } = {}) => {
    if (!currentPlayer) return;
    socket.emit('rewardedResult', economyService.claimRewardedAd(currentPlayer.id, { watched: watched === true }));
  });

  socket.on('claimStarter', () => {
    if (!currentPlayer) return;
    socket.emit('starterResult', economyService.claimStarter(currentPlayer.id));
  });

  socket.on('createPayOrder', ({ sku } = {}) => {
    if (!currentPlayer) return;
    socket.emit('payOrderResult', economyService.createPayOrder(currentPlayer.id, sku));
  });

  socket.on('claimQuest', ({ questId } = {}) => {
    if (!currentPlayer) return;
    socket.emit('questResult', economyService.claimQuest(currentPlayer.id, questId));
  });

  socket.on('buySkin', ({ category, skinId, useCurrency } = {}) => {
    if (!currentPlayer) return;
    socket.emit('buySkinResult', economyService.buySkin(currentPlayer.id, category, skinId, useCurrency));
  });

  socket.on('equipSkin', ({ category, skinId } = {}) => {
    if (!currentPlayer) return;
    socket.emit('equipSkinResult', economyService.equipSkin(currentPlayer.id, category, skinId));
  });

  socket.on('syncEconomy', () => {
    if (!currentPlayer) return;
    socket.emit('economyUpdate', economyService.clientUser(currentPlayer.id));
  });

  // Disconnect
  socket.on('disconnect', () => {
    if (currentPlayer) {
      untrackPlayerSocket(currentPlayer.id, socket.id);
      roomManager.leaveRoom(currentPlayer.id, socket.id);
      io.emit('roomList', roomManager.getRoomList());
    }
  });
});

server.listen(PORT, () => {
  console.log(`===========================================`);
  console.log(`🃏 AAA+++ Durak Online 3D Server running!`);
  console.log(`🌐 Port: ${PORT}`);
  console.log(`🆔 VK App ID: ${VK_APP_ID}`);
  console.log(`===========================================`);
});
