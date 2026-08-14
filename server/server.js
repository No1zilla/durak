/**
 * server.js - Real-Time Game Server for Durak Online 3D (VK Mini App)
 */

const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const { Server } = require('socket.io');

const { RoomManager } = require('./gameEngine/RoomManager');
const { EconomyService, SKINS_CATALOG } = require('./services/economyService');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 3000;
const VK_APP_ID = process.env.VK_APP_ID || '54720415';

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../client')));

// Services
const roomManager = new RoomManager(io);
const economyService = new EconomyService();

// REST API Endpoints
app.get('/api/config', (req, res) => {
  res.json({
    vkAppId: VK_APP_ID,
    serverTime: Date.now(),
    version: '1.0.0-aaa'
  });
});

app.get('/api/shop/catalog', (req, res) => {
  res.json(SKINS_CATALOG);
});

app.get('/api/user/:vkId', (req, res) => {
  const user = economyService.getUser(req.params.vkId);
  res.json(user);
});

app.post('/api/vkpay/order', (req, res) => {
  const { vkId, itemType, amount, orderId } = req.body;
  const result = economyService.addVKPayPurchase(vkId, itemType, amount);
  res.json({ success: true, user: result.user });
});

// Socket.io Real-time Event Handlers
io.on('connection', (socket) => {
  let currentPlayer = null;

  socket.on('auth', (playerData) => {
    currentPlayer = {
      id: playerData.id || 'vk_' + socket.id.substring(0, 6),
      socketId: socket.id,
      name: playerData.name || 'Гость',
      avatar: playerData.avatar || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&h=100&fit=crop',
      chips: playerData.chips || 5000,
      activeTable: playerData.activeTable || 'table_emerald',
      activeDeck: playerData.activeDeck || 'deck_classic'
    };

    socket.emit('authSuccess', {
      player: currentPlayer,
      userEconomy: economyService.getUser(currentPlayer.id)
    });

    // Send room list
    socket.emit('roomList', roomManager.getRoomList());
  });

  socket.on('getRooms', () => {
    socket.emit('roomList', roomManager.getRoomList());
  });

  socket.on('createRoom', (settings) => {
    if (!currentPlayer) return;
    const room = roomManager.createRoom(settings, currentPlayer);
    socket.join(room.id);
    socket.emit('joinedRoom', { roomId: room.id, isHost: true });
    roomManager.broadcastState(room.id);
    io.emit('roomList', roomManager.getRoomList());
  });

  socket.on('joinRoom', ({ roomId, password }) => {
    if (!currentPlayer) return;
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

  socket.on('quickMatch', ({ mode }) => {
    if (!currentPlayer) return;
    const res = roomManager.quickMatch(currentPlayer, mode);
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

  socket.on('addBot', ({ roomId }) => {
    const success = roomManager.addBot(roomId);
    if (success) {
      io.emit('roomList', roomManager.getRoomList());
    }
  });

  socket.on('startGame', ({ roomId }) => {
    const room = roomManager.getRoom(roomId);
    if (!room) return;
    if (room.hostId === currentPlayer.id || room.game.players.length >= 2) {
      room.game.start();
      roomManager.broadcastState(roomId);
      io.emit('roomList', roomManager.getRoomList());
      roomManager.handleBotTurns(roomId);
    }
  });

  // Game Action Handlers
  socket.on('attack', ({ roomId, cardId }) => {
    if (!currentPlayer) return;
    const room = roomManager.getRoom(roomId);
    if (!room) return;

    const res = room.game.attack(currentPlayer.id, cardId);
    if (res.success) {
      roomManager.broadcastState(roomId);
      roomManager.handleBotTurns(roomId);
    } else {
      socket.emit('errorMsg', res.error);
    }
  });

  socket.on('transfer', ({ roomId, cardId }) => {
    if (!currentPlayer) return;
    const room = roomManager.getRoom(roomId);
    if (!room) return;

    const res = room.game.transfer(currentPlayer.id, cardId);
    if (res.success) {
      roomManager.broadcastState(roomId);
      roomManager.handleBotTurns(roomId);
    } else {
      socket.emit('errorMsg', res.error);
    }
  });

  socket.on('defend', ({ roomId, attackCardId, defendCardId }) => {
    if (!currentPlayer) return;
    const room = roomManager.getRoom(roomId);
    if (!room) return;

    const res = room.game.defend(currentPlayer.id, attackCardId, defendCardId);
    if (res.success) {
      roomManager.broadcastState(roomId);
      roomManager.handleBotTurns(roomId);
    } else {
      socket.emit('errorMsg', res.error);
    }
  });

  socket.on('pass', ({ roomId }) => {
    if (!currentPlayer) return;
    const room = roomManager.getRoom(roomId);
    if (!room) return;

    const res = room.game.pass(currentPlayer.id);
    if (res.success) {
      roomManager.broadcastState(roomId);
      roomManager.handleBotTurns(roomId);
    }
  });

  socket.on('take', ({ roomId }) => {
    if (!currentPlayer) return;
    const room = roomManager.getRoom(roomId);
    if (!room) return;

    const res = room.game.take(currentPlayer.id);
    if (res.success) {
      roomManager.broadcastState(roomId);
      roomManager.handleBotTurns(roomId);
    }
  });

  // Interactive 3D Item Throwing (Tomato, Champagne, Coin)
  socket.on('throwItem', ({ roomId, targetPlayerId, itemType }) => {
    if (!currentPlayer) return;
    io.to(roomId).emit('itemThrown', {
      fromPlayerId: currentPlayer.id,
      targetPlayerId,
      itemType: itemType || 'tomato'
    });
  });

  // 3D Emoji Reaction
  socket.on('chatReaction', ({ roomId, emoji }) => {
    if (!currentPlayer) return;
    io.to(roomId).emit('playerReaction', {
      playerId: currentPlayer.id,
      emoji
    });
  });

  // Economy & Shop
  socket.on('claimDailyBonus', () => {
    if (!currentPlayer) return;
    const res = economyService.claimDailyReward(currentPlayer.id);
    socket.emit('dailyBonusResult', res);
  });

  socket.on('buySkin', ({ category, skinId, useCurrency }) => {
    if (!currentPlayer) return;
    const res = economyService.buySkin(currentPlayer.id, category, skinId, useCurrency);
    socket.emit('buySkinResult', res);
  });

  socket.on('equipSkin', ({ category, skinId }) => {
    if (!currentPlayer) return;
    const res = economyService.equipSkin(currentPlayer.id, category, skinId);
    socket.emit('equipSkinResult', res);
  });

  // Disconnect
  socket.on('disconnect', () => {
    if (currentPlayer) {
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
