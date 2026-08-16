/**
 * app.js - Main Client Application Orchestrator for Durak Online 3D (VK Mini App)
 */
/* global io */

import { vk, VK_APP_ID } from './vkBridge.js';
import { sounds } from './audio.js';
import { Scene3D } from './scene3d.js';
import { CardRenderer3D } from './cardRenderer3d.js';
import { ThrowItemsEngine } from './items3d.js';
import { generateStoryImage } from './storyShare.js';

class DurakApp {
  constructor() {
    this.socket = null;
    this.player = null;
    this.userEconomy = null;
    this.currentRoomId = null;
    this.gameState = null;
    this.shopCatalog = null;
    this.targetThrowPlayerId = null;

    // Sub-Engines
    this.scene3D = null;
    this.cardRenderer = null;
    this.throwEngine = null;

    this.init();
  }

  async init() {
    console.log('🚀 Initializing Durak Online 3D...');

    // 1. Initialize VK Bridge
    await vk.init();
    this.player = await vk.getUserInfo();
    this.updateHeaderProfile();

    // 2. Initialize 3D Engine
    const container = document.getElementById('canvas-container');
    this.scene3D = new Scene3D(container);
    this.cardRenderer = new CardRenderer3D(this.scene3D);
    this.throwEngine = new ThrowItemsEngine(this.scene3D);

    // 3. Setup Card Play Interaction
    this.cardRenderer.onCardPlayRequested = (card) => this.handleCardPlay(card);

    // 4. Connect Socket.IO Server
    this.initSocket();

    // 5. Setup UI Event Listeners
    this.bindUIEvents();

    // 6. Fetch Shop Catalog
    this.fetchShopCatalog();

    // Continuous seat badge positioning loop
    this.startHUDPositionLoop();
  }

  startHUDPositionLoop() {
    const update = () => {
      if (this.gameState && this.currentRoomId) {
        this.updatePlayerSeatPositions(this.gameState);
      }
      requestAnimationFrame(update);
    };
    requestAnimationFrame(update);
  }

  updateHeaderProfile() {
    if (!this.player) return;
    document.getElementById('user-name').textContent = this.player.name;
    document.getElementById('user-avatar').src = this.player.avatar;
    if (this.userEconomy) {
      document.getElementById('user-chips').textContent = Number(this.userEconomy.chips).toLocaleString();
      document.getElementById('user-gold').textContent = Number(this.userEconomy.gold).toLocaleString();
    }
  }

  initSocket() {
    this.socket = io();

    this.socket.on('connect', () => {
      console.log('⚡ Connected to Game Server. Authenticating...');
      this.socket.emit('auth', {
        id: this.player.id,
        name: this.player.name,
        avatar: this.player.avatar,
        launchParams: new URLSearchParams(window.location.search).has('sign') ? window.location.search : ''
      });
    });

    this.socket.on('authSuccess', ({ player, userEconomy }) => {
      this.userEconomy = userEconomy;
      this.updateHeaderProfile();
      if (userEconomy.activeTable) {
        this.applyTableSkin(userEconomy.activeTable);
      }
      if (userEconomy.activeDeck) {
        this.cardRenderer.setDeckSkin(userEconomy.activeDeck);
      }
    });

    this.socket.on('roomList', (rooms) => this.renderRoomList(rooms));

    this.socket.on('joinedRoom', ({ roomId, isHost }) => {
      this.currentRoomId = roomId;
      this.switchView('game-hud');
      this.showToast('Вы вошли за стол');
      vk.taptic('medium');
    });

    this.socket.on('leftRoom', () => {
      this.currentRoomId = null;
      this.gameState = null;
      this.cardRenderer.clear();
      this.switchView('lobby-view');
      this.scene3D.updateCameraForPlayerCount(4);
    });

    this.socket.on('gameState', (state) => this.onGameStateUpdated(state));

    this.socket.on('itemThrown', ({ fromPlayerId, targetPlayerId, itemType }) => {
      this.handleRemoteItemThrown(fromPlayerId, targetPlayerId, itemType);
    });

    this.socket.on('errorMsg', (msg) => {
      this.showToast(msg);
      vk.taptic('heavy');
    });

    this.socket.on('dailyBonusResult', (res) => {
      if (res.success) {
        this.userEconomy = res.user;
        this.updateHeaderProfile();
        this.showToast(`🎁 Получено +${res.reward.chips} фишек и +${res.reward.gold} золота!`);
        sounds.playChipsClink();
        vk.taptic('medium');
      } else {
        this.showToast(res.error);
      }
    });
  }

  onGameStateUpdated(state) {
    if (!this.currentRoomId || state.id !== this.currentRoomId) return;
    this.gameState = state;
    const isLocalPlayerInGame = state.players.some(p => p.id === this.player.id);
    if (!isLocalPlayerInGame) return;

    // 1. Adjust Camera and Table for Player Count
    this.scene3D.updateCameraForPlayerCount(state.players.length);

    // 2. Render 3D Local Hand Cards
    const localPlayer = state.players.find(p => p.id === this.player.id);
    if (localPlayer) {
      this.cardRenderer.renderLocalHand(localPlayer.hand || []);
    }

    // 3. Render 3D Opponents Hands
    this.cardRenderer.renderOpponentsHands(state.players, this.player.id);

    // 4. Render Deck Stack & Trump Card
    this.cardRenderer.renderDeckAndTrump(state.deckRemaining, state.trumpCard);

    // 5. Render Active Table Attack/Defense Pairs
    this.cardRenderer.renderTablePairs(state.tablePairs || []);

    // 6. Update HUD Top Bar
    if (state.trumpCard) {
      const suitSymbols = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' };
      const suitEl = document.getElementById('hud-trump-suit');
      suitEl.textContent = suitSymbols[state.trumpSuit] || '♠';
      suitEl.className = `trump-suit-icon ${state.trumpSuit}`;
      document.getElementById('hud-deck-count').textContent = `${state.deckRemaining} карт`;
    }
    document.getElementById('hud-game-mode').textContent = state.mode === 'perevodnoy' ? 'Переводной' : 'Подкидной';

    // 7. Update HUD Player Seats (3D projection)
    this.renderPlayerSeats(state);

    // 8. Update Turn Timer & Action Buttons
    this.updateTurnControls(state);

    // 9. Check Game Over / Victory Screen
    if (state.state === 'GAME_OVER') {
      this.handleGameOver(state);
    }
  }

  renderPlayerSeats(state) {
    const container = document.getElementById('player-seats-hud');
    container.innerHTML = '';

    const total = state.players.length;
    const localIdx = state.players.findIndex(p => p.id === this.player.id);

    state.players.forEach((p, i) => {
      // Don't render avatar badge for local player at bottom
      if (p.id === this.player.id) return;

      const isAttacker = p.id === state.attackerId;
      const isDefender = p.id === state.defenderId;

      const badge = document.createElement('div');
      badge.className = `seat-badge-3d ${isAttacker ? 'active-turn' : ''} ${isDefender ? 'defender' : ''}`;
      badge.dataset.playerId = p.id;
      badge.dataset.seatIndex = i;

      badge.innerHTML = `
        <div class="seat-avatar-ring">
          <img src="${p.avatar || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&h=100&fit=crop'}" alt="${p.name}">
          <span class="seat-card-count">${p.cardsCount || 0}</span>
        </div>
        <div class="seat-name-tag">${p.name} ${isAttacker ? '⚔️' : isDefender ? '🛡️' : ''}</div>
      `;

      badge.addEventListener('click', (e) => {
        e.stopPropagation();
        this.targetThrowPlayerId = p.id;
        this.toggleThrowMenu(true);
      });

      container.appendChild(badge);
    });

    this.updatePlayerSeatPositions(state);
  }

  updatePlayerSeatPositions(state) {
    const total = state.players.length;
    const seat3DPositions = this.scene3D.getSeatPositions(total);
    const localIdx = state.players.findIndex(p => p.id === this.player.id);

    const badges = document.querySelectorAll('.seat-badge-3d');
    badges.forEach(badge => {
      const idx = parseInt(badge.dataset.seatIndex, 10);
      const relativeIdx = (idx - localIdx + total) % total;
      const pos3D = seat3DPositions[relativeIdx];
      const screenPos = this.scene3D.toScreenPosition(pos3D);

      if (screenPos.visible) {
        badge.style.display = 'flex';
        badge.style.left = `${screenPos.x}px`;
        badge.style.top = `${screenPos.y}px`;
      } else {
        badge.style.display = 'none';
      }
    });
  }

  updateTurnControls(state) {
    const isAttacker = state.attackerId === this.player.id;
    const isDefender = state.defenderId === this.player.id;
    const isTransferable = state.mode === 'perevodnoy';

    const btnTransfer = document.getElementById('btn-action-transfer');
    const btnDefend = document.getElementById('btn-action-defend');
    const btnTake = document.getElementById('btn-action-take');
    const btnPass = document.getElementById('btn-action-pass');
    const promptBubble = document.getElementById('action-prompt');

    // Default disable all
    btnTransfer?.classList.add('disabled');
    btnDefend?.classList.add('disabled');
    btnTake?.classList.add('disabled');
    btnPass?.classList.add('disabled');

    if (isDefender) {
      promptBubble.textContent = '🛡️ Вы отбиваетесь! Выберите карту или заберите';
      if (state.tablePairs.length > 0) {
        btnTake?.classList.remove('disabled');
        btnDefend?.classList.remove('disabled');
      }
      if (isTransferable && state.tablePairs.every(p => !p.defense)) {
        btnTransfer?.classList.remove('disabled');
      }
    } else if (isAttacker) {
      promptBubble.textContent = state.tablePairs.length === 0 ? '⚔️ Ваш ход! Выберите карту для атаки' : '⚔️ Подкиньте карту или нажмите Бита';
      if (state.tablePairs.length > 0) {
        btnPass?.classList.remove('disabled');
      }
    } else {
      if (state.tablePairs.length > 0) {
        promptBubble.textContent = 'Можно подкинуть карту подходящего номинала';
        btnPass?.classList.remove('disabled');
      } else {
        promptBubble.textContent = 'Ожидание хода соперника...';
      }
    }

    const timerBar = document.getElementById('hud-timer-bar');
    const timerText = document.getElementById('hud-timer-text');

    // Clear previous timer interval
    if (this._timerInterval) clearInterval(this._timerInterval);

    if (state.turnStartTime && state.turnTimeLimit) {
      const updateTimer = () => {
        const elapsedSec = (Date.now() - state.turnStartTime) / 1000;
        const remainingSec = Math.max(0, Math.ceil(state.turnTimeLimit - elapsedSec));
        const pct = (remainingSec / state.turnTimeLimit) * 100;
        timerBar.style.width = `${pct}%`;
        timerText.textContent = `${remainingSec}s`;
        if (pct < 30) timerBar.classList.add('danger');
        else timerBar.classList.remove('danger');
        if (remainingSec <= 0 && this._timerInterval) {
          clearInterval(this._timerInterval);
          this._timerInterval = null;
        }
      };
      updateTimer();
      this._timerInterval = setInterval(updateTimer, 1000);
    }
  }

  handleCardPlay(card) {
    if (!this.gameState || !this.currentRoomId) return;

    const isDefender = this.gameState.defenderId === this.player.id;
    vk.taptic('light');

    if (isDefender) {
      if (this.gameState.mode === 'perevodnoy' && this.gameState.tablePairs.length > 0 && this.gameState.tablePairs.every(p => !p.defense)) {
        if (this.gameState.tablePairs[0].attack.rank === card.rank) {
          this.socket.emit('transfer', { roomId: this.currentRoomId, cardId: card.id });
          return;
        }
      }

      const undefended = this.gameState.tablePairs.find(p => p.defense === null);
      if (undefended) {
        this.socket.emit('defend', {
          roomId: this.currentRoomId,
          attackCardId: undefended.attack.id,
          defendCardId: card.id
        });
      }
    } else {
      this.socket.emit('attack', { roomId: this.currentRoomId, cardId: card.id });
    }
  }

  handleGameOver(state) {
    const isWinner = state.winners && state.winners.some(w => w.id === this.player.id);
    const isDurak = state.durak && state.durak.id === this.player.id;

    const vicTitle = document.getElementById('vic-title');
    const vicSubtitle = document.getElementById('vic-subtitle');
    const vicReward = document.getElementById('vic-reward');

    if (isWinner) {
      vicTitle.textContent = 'ПОБЕДА';
      vicSubtitle.textContent = `${state.mode === 'perevodnoy' ? 'Переводной' : 'Подкидной'} Дурак • Победа!`;
      vicReward.textContent = `+${state.bet * (state.players.length - 1)}`;
      sounds.playVictory();
      vk.taptic('heavy');
    } else if (isDurak) {
      vicTitle.textContent = 'ДУРАК';
      vicSubtitle.textContent = 'Вы остались с картами на руках';
      vicReward.textContent = `-${state.bet}`;
    } else {
      vicTitle.textContent = 'РАУНД ОКОНЧЕН';
      vicSubtitle.textContent = 'Партия завершена';
      vicReward.textContent = '0';
    }

    document.getElementById('vic-player-name').textContent = this.player.name;
    document.getElementById('vic-avatar').src = this.player.avatar;

    document.getElementById('modal-victory').classList.add('active');
  }

  handleRemoteItemThrown(fromPlayerId, targetPlayerId, itemType) {
    if (!this.gameState) return;
    const total = this.gameState.players.length;
    const seat3DPositions = this.scene3D.getSeatPositions(total);
    const localIdx = this.gameState.players.findIndex(p => p.id === this.player.id);

    const fromIdx = this.gameState.players.findIndex(p => p.id === fromPlayerId);
    const targetIdx = this.gameState.players.findIndex(p => p.id === targetPlayerId);

    if (fromIdx !== -1 && targetIdx !== -1) {
      const p1 = seat3DPositions[(fromIdx - localIdx + total) % total];
      const p2 = seat3DPositions[(targetIdx - localIdx + total) % total];
      this.throwEngine.throwItem(p1, p2, itemType);
    }
  }

  bindUIEvents() {
    document.getElementById('btn-quick-podkidnoy').addEventListener('click', () => {
      this.socket.emit('quickMatch', { mode: 'podkidnoy' });
    });

    document.getElementById('btn-quick-perevodnoy').addEventListener('click', () => {
      this.socket.emit('quickMatch', { mode: 'perevodnoy' });
    });

    document.getElementById('btn-open-create-modal').addEventListener('click', () => {
      document.getElementById('modal-create-room').classList.add('active');
    });

    document.getElementById('btn-close-create').addEventListener('click', () => {
      document.getElementById('modal-create-room').classList.remove('active');
    });

    document.getElementById('input-players').addEventListener('input', (e) => {
      document.getElementById('val-players').textContent = e.target.value;
    });

    document.querySelectorAll('.toggle-option').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const parent = e.target.parentElement;
        parent.querySelectorAll('.toggle-option').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
      });
    });

    document.querySelectorAll('.bet-preset').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.bet-preset').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
      });
    });

    document.getElementById('btn-confirm-create-room').addEventListener('click', () => {
      const modeBtn = document.querySelector('.radio-toggle-group .toggle-option.active[data-mode]');
      const deckBtn = document.querySelector('.radio-toggle-group .toggle-option.active[data-deck]');
      const betBtn = document.querySelector('.bet-preset.active');
      const maxPlayers = parseInt(document.getElementById('input-players').value, 10);

      this.socket.emit('createRoom', {
        mode: modeBtn ? modeBtn.dataset.mode : 'podkidnoy',
        deckSize: deckBtn ? parseInt(deckBtn.dataset.deck, 10) : 36,
        maxPlayers,
        bet: betBtn ? parseInt(betBtn.dataset.bet, 10) : 100
      });

      document.getElementById('modal-create-room').classList.remove('active');
    });

    document.getElementById('btn-action-take')?.addEventListener('click', () => {
      if (this.currentRoomId) this.socket.emit('take', { roomId: this.currentRoomId });
    });

    document.getElementById('btn-action-pass')?.addEventListener('click', () => {
      if (this.currentRoomId) this.socket.emit('pass', { roomId: this.currentRoomId });
    });

    document.getElementById('btn-action-defend')?.addEventListener('click', () => {
      this.showToast('Нажмите на карту в руке, чтобы побить!');
    });

    document.getElementById('btn-action-transfer')?.addEventListener('click', () => {
      if (this.currentRoomId && this.gameState && this.gameState.tablePairs.length > 0) {
        const targetRank = this.gameState.tablePairs[0].attack.rank;
        const myHand = this.gameState.players.find(p => p.id === this.player.id)?.hand || [];
        const transferCard = myHand.find(c => c.rank === targetRank);
        if (transferCard) {
          this.socket.emit('transfer', { roomId: this.currentRoomId, cardId: transferCard.id });
        } else {
          this.showToast(`Нужна карта номинала ${this.gameState.tablePairs[0].attack.label} для перевода`);
        }
      }
    });

    document.getElementById('btn-sound-toggle')?.addEventListener('click', () => {
      const enabled = sounds.toggle();
      document.getElementById('btn-sound-toggle').textContent = enabled ? '🔊' : '🔇';
    });

    document.getElementById('btn-chat-toggle')?.addEventListener('click', () => {
      this.showToast('💬 Быстрый чат: «Спасибо за игру!», «Удачи!», «Хороший ход!»');
    });

    document.getElementById('btn-leave-game')?.addEventListener('click', () => {
      this.socket.emit('leaveRoom');
    });

    document.getElementById('btn-add-bot')?.addEventListener('click', () => {
      if (this.currentRoomId) {
        this.socket.emit('addBot', { roomId: this.currentRoomId });
        this.showToast('Бот добавлен за стол 🤖');
      }
    });

    document.getElementById('btn-sound')?.addEventListener('click', () => {
      const enabled = sounds.toggle();
      document.getElementById('sound-icon').textContent = enabled ? '🔊' : '🔇';
    });

    document.getElementById('btn-daily').addEventListener('click', () => {
      this.socket.emit('claimDailyBonus');
    });

    document.getElementById('btn-shop').addEventListener('click', () => {
      document.getElementById('modal-shop').classList.add('active');
      this.renderShopTab('decks');
    });

    document.getElementById('btn-close-shop').addEventListener('click', () => {
      document.getElementById('modal-shop').classList.remove('active');
    });

    document.querySelectorAll('.shop-tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        document.querySelectorAll('.shop-tab').forEach(t => t.classList.remove('active'));
        e.target.classList.add('active');
        this.renderShopTab(e.target.dataset.tab);
      });
    });

    document.getElementById('btn-throw-menu').addEventListener('click', () => {
      this.toggleThrowMenu();
    });

    document.querySelectorAll('.btn-throw-item').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const itemType = e.currentTarget.dataset.item;
        if (this.currentRoomId && this.targetThrowPlayerId) {
          this.socket.emit('throwItem', {
            roomId: this.currentRoomId,
            targetPlayerId: this.targetThrowPlayerId,
            itemType
          });
        }
        this.toggleThrowMenu(false);
      });
    });

    document.getElementById('btn-share-vk-story').addEventListener('click', async () => {
      const dataUrl = await generateStoryImage({
        player: this.player,
        reward: 1500,
        streak: 5,
        matchTime: '03:45',
        mode: this.gameState ? this.gameState.mode : 'Подкидной'
      });
      await vk.shareToStory(dataUrl);
    });

    document.getElementById('btn-share-vk-wall').addEventListener('click', async () => {
      await vk.postToWall('Победа в Дурак Онлайн 3D! 🃏🔥');
    });

    document.getElementById('btn-victory-lobby').addEventListener('click', () => {
      document.getElementById('modal-victory').classList.remove('active');
      this.socket.emit('leaveRoom');
    });
  }

  toggleThrowMenu(forceShow) {
    const menu = document.getElementById('menu-throw-items');
    if (forceShow !== undefined) {
      if (forceShow) menu.classList.remove('hidden');
      else menu.classList.add('hidden');
    } else {
      menu.classList.toggle('hidden');
    }
  }

  switchView(viewId) {
    document.querySelectorAll('.view-screen').forEach(v => v.classList.remove('active'));
    const target = document.getElementById(viewId);
    if (target) target.classList.add('active');
  }

  renderRoomList(rooms) {
    const container = document.getElementById('rooms-list');
    container.innerHTML = '';

    if (!rooms || rooms.length === 0) {
      container.innerHTML = '<div style="text-align:center; padding: 12px; font-size:12px; color: var(--text-muted);">Нет открытых столов. Создайте свой!</div>';
      return;
    }

    rooms.forEach(r => {
      const card = document.createElement('div');
      card.className = 'room-card';
      card.innerHTML = `
        <div class="room-card-left">
          <span class="room-mode-tag ${r.mode}">${r.mode === 'perevodnoy' ? 'Переводной' : 'Подкидной'}</span>
          <div>
            <div class="room-title">${r.name}</div>
            <div class="room-bet">Ставка: ${r.bet} 🪙 • ${r.deckSize} карт</div>
          </div>
        </div>
        <div class="room-card-right">
          <div class="room-avatars">
            ${(r.avatars || []).map(a => `<img class="room-avatar-mini" src="${a}">`).join('')}
          </div>
          <span class="room-players-badge">${r.playersCount}/${r.maxPlayers}</span>
        </div>
      `;
      card.addEventListener('click', () => {
        this.socket.emit('joinRoom', { roomId: r.id });
      });
      container.appendChild(card);
    });
  }

  async fetchShopCatalog() {
    try {
      const res = await fetch('/api/shop/catalog');
      this.shopCatalog = await res.json();
    } catch (e) {
      console.warn('Could not fetch shop catalog:', e);
    }
  }

  renderShopTab(tab) {
    const container = document.getElementById('shop-catalog-container');
    container.innerHTML = '';
    if (!this.shopCatalog) return;

    if (tab === 'decks') {
      this.shopCatalog.decks.forEach(item => {
        const isOwned = this.userEconomy && this.userEconomy.ownedDecks.includes(item.id);
        const isEquipped = this.userEconomy && this.userEconomy.activeDeck === item.id;

        const card = document.createElement('div');
        card.className = 'shop-item-card';
        card.innerHTML = `
          <div class="shop-item-name">${item.name}</div>
          <button class="btn-buy-skin ${isEquipped ? 'equipped' : ''}">
            ${isEquipped ? 'Надето' : isOwned ? 'Надеть' : `${item.priceCoins} 🪙`}
          </button>
        `;
        const btn = card.querySelector('button');
        btn.addEventListener('click', () => {
          if (isOwned) {
            this.socket.emit('equipSkin', { category: 'decks', skinId: item.id });
            this.userEconomy.activeDeck = item.id;
            this.cardRenderer.setDeckSkin(item.id);
            this.renderShopTab('decks');
          } else {
            this.socket.emit('buySkin', { category: 'decks', skinId: item.id, useCurrency: 'chips' });
          }
        });
        container.appendChild(card);
      });
    } else if (tab === 'tables') {
      this.shopCatalog.tables.forEach(item => {
        const isOwned = this.userEconomy && this.userEconomy.ownedTables.includes(item.id);
        const isEquipped = this.userEconomy && this.userEconomy.activeTable === item.id;

        const card = document.createElement('div');
        card.className = 'shop-item-card';
        card.innerHTML = `
          <div class="shop-item-name">${item.name}</div>
          <button class="btn-buy-skin ${isEquipped ? 'equipped' : ''}">
            ${isEquipped ? 'Надето' : isOwned ? 'Надеть' : `${item.priceCoins} 🪙`}
          </button>
        `;
        const btn = card.querySelector('button');
        btn.addEventListener('click', () => {
          if (isOwned) {
            this.socket.emit('equipSkin', { category: 'tables', skinId: item.id });
            this.userEconomy.activeTable = item.id;
            this.applyTableSkin(item.id);
            this.renderShopTab('tables');
          } else {
            this.socket.emit('buySkin', { category: 'tables', skinId: item.id, useCurrency: 'chips' });
          }
        });
        container.appendChild(card);
      });
    } else if (tab === 'currency') {
      const packs = [
        { name: '10,000 Фишек', priceRub: 99, chips: 10000 },
        { name: '50,000 Фишек + VIP', priceRub: 299, chips: 50000 },
        { name: '150,000 Фишек (Хит)', priceRub: 699, chips: 150000 }
      ];

      packs.forEach(pack => {
        const card = document.createElement('div');
        card.className = 'shop-item-card';
        card.innerHTML = `
          <div class="shop-item-name">${pack.name}</div>
          <button class="btn-hero vk-blue" style="width:100%; padding: 10px 8px; justify-content:center;">
            <span>${pack.priceRub} ₽ (VK Pay)</span>
          </button>
        `;
        card.querySelector('button').addEventListener('click', async () => {
          const payment = await vk.openVKPay(pack.priceRub, pack.name);
          this.showToast(payment
            ? 'Платёж отправлен на серверную проверку'
            : 'VK Pay недоступен');
        });
        container.appendChild(card);
      });
    }
  }

  applyTableSkin(tableSkinId) {
    const colors = {
      table_emerald: '#0b2b1b',
      table_red: '#4a111a',
      table_carbon: '#161a22',
      table_marble: '#0d2238'
    };
    if (this.scene3D && colors[tableSkinId]) {
      this.scene3D.setTableColor(colors[tableSkinId]);
    }
  }

  showToast(message) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2600);
  }
}

// Instantiate on load
if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', () => {
    window.app = new DurakApp();
  });
} else {
  window.app = new DurakApp();
}
