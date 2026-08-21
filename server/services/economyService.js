const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { JsonStore } = require('../store');

const DAY_MS = 24 * 60 * 60 * 1000;
const REWARDED_DAILY_CAP = 3;
const REWARDED_COOLDOWN_MS = 8000;
const REWARDED_CHIPS = 400;
const DEFAULT_FILE = path.join(__dirname, '../../data/state.json');

function resolveEconomyFile(env = process.env) {
  if (env.ECONOMY_FILE) return env.ECONOMY_FILE;
  try {
    if (fs.existsSync('/data') && fs.statSync('/data').isDirectory()) {
      return path.join('/data', 'state.json');
    }
  } catch {
    // fall through to repo data/
  }
  return DEFAULT_FILE;
}

const DAILY_STREAK = [
  { chips: 1500, gold: 10 },
  { chips: 1800, gold: 12 },
  { chips: 2200, gold: 15 },
  { chips: 2700, gold: 18 },
  { chips: 3300, gold: 22 },
  { chips: 4000, gold: 28 },
  { chips: 5000, gold: 40 }
];

const SKINS_CATALOG = {
  decks: [
    { id: 'deck_classic', name: 'Классический Атласный', priceCoins: 0, priceGold: 0, rarity: 'common', preview: 'assets/cards/back_classic.jpg' },
    { id: 'deck_imperial', name: 'Императорский 1913', priceCoins: 2500, priceGold: 50, rarity: 'rare', preview: 'assets/cards/back_imperial.jpg' },
    { id: 'deck_cyberpunk', name: 'Киберпанк Неон', priceCoins: 5000, priceGold: 100, rarity: 'epic', preview: '' },
    { id: 'deck_gold', name: 'Золотой Век (Foil)', priceCoins: 10000, priceGold: 200, rarity: 'legendary', preview: '' }
  ],
  tables: [
    { id: 'table_emerald', name: 'Изумрудный Бархат', priceCoins: 0, priceGold: 0, color: '#114227' },
    { id: 'table_red', name: 'Винный Барокко', priceCoins: 3000, priceGold: 60, color: '#4a111a' },
    { id: 'table_carbon', name: 'Карбон & Неон', priceCoins: 6000, priceGold: 120, color: '#161a22' },
    { id: 'table_marble', name: 'Королевский Мрамор', priceCoins: 12000, priceGold: 250, color: '#0d2238' }
  ],
  frames: [
    { id: 'frame_none', name: 'Без рамки', priceCoins: 0 },
    { id: 'frame_gold', name: 'Золотой кант', priceCoins: 2000, priceGold: 40 }
  ],
  emotions: [
    { id: 'emo_basic', name: 'Базовые реакции', priceCoins: 0 }
  ]
};

const VKPAY_SKUS = {
  chips_3k: { id: 'chips_3k', name: '3 000 фишек', priceRub: 29, priceVotes: 5, chips: 3000, gold: 0, vipDays: 0 },
  chips_10k: { id: 'chips_10k', name: '10 000 фишек', priceRub: 99, priceVotes: 15, chips: 10000, gold: 20, vipDays: 0 },
  chips_50k_vip: { id: 'chips_50k_vip', name: '50 000 фишек + VIP', priceRub: 299, priceVotes: 43, chips: 50000, gold: 80, vipDays: 30 },
  chips_150k: { id: 'chips_150k', name: '150 000 фишек (хит)', priceRub: 699, priceVotes: 100, chips: 150000, gold: 200, vipDays: 0 }
};

const STARTER = { id: 'starter_imperial', chips: 2500, gold: 20, deck: 'deck_imperial' };
const QUESTS = [
  { id: 'play_match', name: 'Сыграть партию', chips: 400 },
  { id: 'win_match', name: 'Выиграть партию', chips: 800 },
  { id: 'claim_daily', name: 'Забрать ежедневку', chips: 300 }
];

function utcDay(ts = Date.now()) {
  return Math.floor(ts / DAY_MS);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

class EconomyService {
  constructor(options = {}) {
    this.store = new JsonStore(options.filePath || resolveEconomyFile());
    this.now = options.now || (() => Date.now());
  }

  persist() {
    this.store.write();
  }

  getUser(vkId) {
    const users = this.store.data.users;
    if (!users[vkId]) {
      const ts = this.now();
      users[vkId] = {
        vkId,
        chips: 5000,
        gold: 50,
        ownedDecks: ['deck_classic'],
        ownedTables: ['table_emerald'],
        ownedFrames: ['frame_none'],
        ownedEmotions: ['emo_basic'],
        activeDeck: 'deck_classic',
        activeTable: 'table_emerald',
        activeFrame: 'frame_none',
        lastDailyClaim: null,
        dailyStreak: 0,
        lastDailyDay: 0,
        starterClaimed: false,
        vipUntil: 0,
        rewardedDay: 0,
        rewardedCount: 0,
        lastRewardedAt: 0,
        quests: this.emptyQuests(ts),
        winStreak: 0,
        totalWins: 0,
        totalGames: 0,
        firstSeen: ts,
        lastSeen: ts
      };
      this.persist();
    }
    this.ensureQuests(users[vkId]);
    return users[vkId];
  }

  emptyQuests(ts) {
    return { day: utcDay(ts), play: false, win: false, daily: false, claimed: [] };
  }

  ensureQuests(user) {
    const day = utcDay(this.now());
    if (!user.quests || user.quests.day !== day) {
      user.quests = this.emptyQuests(this.now());
    }
  }

  toClient(user) {
    const day = utcDay(this.now());
    const rewardedUsed = user.rewardedDay === day ? user.rewardedCount : 0;
    return {
      vkId: user.vkId,
      chips: user.chips,
      gold: user.gold,
      ownedDecks: user.ownedDecks,
      ownedTables: user.ownedTables,
      ownedFrames: user.ownedFrames,
      ownedEmotions: user.ownedEmotions,
      activeDeck: user.activeDeck,
      activeTable: user.activeTable,
      activeFrame: user.activeFrame,
      lastDailyClaim: user.lastDailyClaim,
      dailyStreak: user.dailyStreak,
      dailyAvailable: this.dailyAvailable(user),
      starterClaimed: user.starterClaimed,
      vipActive: user.vipUntil > this.now(),
      rewardedLeft: Math.max(0, REWARDED_DAILY_CAP - rewardedUsed),
      quests: {
        play: user.quests.play,
        win: user.quests.win,
        daily: user.quests.daily,
        claimed: user.quests.claimed
      },
      winStreak: user.winStreak,
      totalWins: user.totalWins,
      totalGames: user.totalGames
    };
  }

  clientUser(vkId) {
    return this.toClient(this.getUser(vkId));
  }

  touchSession(vkId) {
    const user = this.getUser(vkId);
    user.lastSeen = this.now();
    this.persist();
    return this.toClient(user);
  }

  findLedger(key) {
    return this.store.data.ledger.find(entry => entry.key === key) || null;
  }

  credit(vkId, currency, delta, type, key, meta = {}) {
    const existing = this.findLedger(key);
    if (existing) {
      return { success: true, duplicate: true, entry: existing, user: this.getUser(vkId) };
    }
    const user = this.getUser(vkId);
    if (currency === 'gold') user.gold += delta;
    else user.chips += delta;
    const entry = {
      id: crypto.randomUUID(),
      userId: vkId,
      type,
      currency,
      delta,
      balanceAfter: currency === 'gold' ? user.gold : user.chips,
      key,
      createdAt: this.now(),
      meta
    };
    this.store.data.ledger.push(entry);
    if (this.store.data.ledger.length > 8000) {
      this.store.data.ledger = this.store.data.ledger.slice(-4000);
    }
    if (!meta.silent) this.persist();
    return { success: true, duplicate: false, entry, user };
  }

  dailyAvailable(user) {
    if (!user.lastDailyClaim) return true;
    return utcDay(this.now()) > utcDay(user.lastDailyClaim);
  }

  claimDailyReward(vkId) {
    const user = this.getUser(vkId);
    this.ensureQuests(user);
    if (!this.dailyAvailable(user)) {
      const remainingHours = Math.ceil((DAY_MS - (this.now() - user.lastDailyClaim)) / (60 * 60 * 1000));
      return { success: false, error: `Следующая награда через ${remainingHours} ч.` };
    }

    const today = utcDay(this.now());
    const yesterday = today - 1;
    let streak = 1;
    if (user.lastDailyDay === yesterday) streak = Math.min(7, (user.dailyStreak || 0) + 1);
    const reward = DAILY_STREAK[streak - 1];
    const key = `daily:${vkId}:${today}`;
    this.credit(vkId, 'chips', reward.chips, 'daily', `${key}:chips`);
    this.credit(vkId, 'gold', reward.gold, 'daily', `${key}:gold`);
    user.lastDailyClaim = this.now();
    user.lastDailyDay = today;
    user.dailyStreak = streak;
    user.quests.daily = true;
    this.persist();
    return { success: true, reward: { ...reward, streak }, user: this.toClient(user) };
  }

  claimRewardedAd(vkId, { watched } = {}) {
    if (watched !== true) {
      return { success: false, error: 'Награда только после просмотра рекламы' };
    }
    const user = this.getUser(vkId);
    const day = utcDay(this.now());
    if (user.rewardedDay !== day) {
      user.rewardedDay = day;
      user.rewardedCount = 0;
    }
    if (user.rewardedCount >= REWARDED_DAILY_CAP) {
      return { success: false, error: 'Лимит рекламы на сегодня исчерпан' };
    }
    if (user.lastRewardedAt && this.now() - user.lastRewardedAt < REWARDED_COOLDOWN_MS) {
      return { success: false, error: 'Подождите несколько секунд' };
    }
    user.rewardedCount += 1;
    user.lastRewardedAt = this.now();
    this.store.data.analytics.rewardedClaims += 1;
    this.credit(vkId, 'chips', REWARDED_CHIPS, 'rewarded', `rewarded:${vkId}:${day}:${user.rewardedCount}`);
    this.persist();
    return { success: true, reward: { chips: REWARDED_CHIPS }, user: this.toClient(user) };
  }

  claimStarter(vkId) {
    const user = this.getUser(vkId);
    if (user.starterClaimed) return { success: false, error: 'Стартовый набор уже получен' };
    const key = `starter:${vkId}`;
    this.credit(vkId, 'chips', STARTER.chips, 'starter', `${key}:chips`);
    this.credit(vkId, 'gold', STARTER.gold, 'starter', `${key}:gold`);
    if (!user.ownedDecks.includes(STARTER.deck)) user.ownedDecks.push(STARTER.deck);
    user.activeDeck = STARTER.deck;
    user.starterClaimed = true;
    this.persist();
    return { success: true, user: this.toClient(user), item: STARTER };
  }

  buySkin(vkId, category, skinId, useCurrency = 'chips') {
    const user = this.getUser(vkId);
    const lists = {
      decks: { catalog: SKINS_CATALOG.decks, owned: 'ownedDecks' },
      tables: { catalog: SKINS_CATALOG.tables, owned: 'ownedTables' },
      frames: { catalog: SKINS_CATALOG.frames, owned: 'ownedFrames' },
      emotions: { catalog: SKINS_CATALOG.emotions, owned: 'ownedEmotions' }
    };
    const group = lists[category];
    if (!group) return { success: false, error: 'Категория не найдена' };
    const item = group.catalog.find(entry => entry.id === skinId);
    if (!item) return { success: false, error: 'Товар не найден' };
    if (user[group.owned].includes(skinId)) return { success: false, error: 'Предмет уже куплен' };

    const price = useCurrency === 'gold' ? (item.priceGold || 0) : (item.priceCoins || 0);
    if (useCurrency === 'gold' && user.gold < price) return { success: false, error: 'Недостаточно золота' };
    if (useCurrency !== 'gold' && user.chips < price) return { success: false, error: 'Недостаточно фишек' };
    if (price > 0) {
      this.credit(vkId, useCurrency === 'gold' ? 'gold' : 'chips', -price, 'buy_skin', `buy:${vkId}:${skinId}:${useCurrency}`);
    }
    user[group.owned].push(skinId);
    this.store.data.analytics.shopPurchases += 1;
    this.persist();
    return { success: true, user: this.toClient(user), item };
  }

  equipSkin(vkId, category, skinId) {
    const user = this.getUser(vkId);
    const map = {
      decks: { owned: 'ownedDecks', active: 'activeDeck' },
      tables: { owned: 'ownedTables', active: 'activeTable' },
      frames: { owned: 'ownedFrames', active: 'activeFrame' }
    };
    const group = map[category];
    if (!group) return { success: false, error: 'Категория не найдена' };
    if (!user[group.owned].includes(skinId)) return { success: false, error: 'Скин не куплен' };
    user[group.active] = skinId;
    this.persist();
    return { success: true, user: this.toClient(user) };
  }

  claimQuest(vkId, questId) {
    const user = this.getUser(vkId);
    this.ensureQuests(user);
    const quest = QUESTS.find(entry => entry.id === questId);
    if (!quest) return { success: false, error: 'Задание не найдено' };
    const done = questId === 'play_match' ? user.quests.play
      : questId === 'win_match' ? user.quests.win
        : user.quests.daily;
    if (!done) return { success: false, error: 'Задание ещё не выполнено' };
    if (user.quests.claimed.includes(questId)) return { success: false, error: 'Награда уже получена' };
    const day = utcDay(this.now());
    this.credit(vkId, 'chips', quest.chips, 'quest', `quest:${vkId}:${day}:${questId}`);
    user.quests.claimed.push(questId);
    this.persist();
    return { success: true, reward: { chips: quest.chips }, user: this.toClient(user) };
  }

  markMatchStarted() {
    this.store.data.analytics.matchesStarted += 1;
    this.persist();
  }

  settleMatch(room) {
    const game = room.game;
    if (!game || game.state !== 'GAME_OVER') return;
    const settleKey = `match:${game.id}:settled`;
    if (this.findLedger(settleKey)) return;
    this.store.data.ledger.push({
      id: crypto.randomUUID(),
      userId: '*',
      type: 'match_settle',
      currency: 'chips',
      delta: 0,
      balanceAfter: 0,
      key: settleKey,
      createdAt: this.now(),
      meta: {}
    });
    this.store.data.analytics.matchesCompleted += 1;
    const winnerIds = new Set((game.winners || []).map(player => player.id));
    for (const player of game.players) {
      if (player.isBot) continue;
      const user = this.getUser(player.id);
      this.ensureQuests(user);
      user.totalGames += 1;
      user.quests.play = true;
      if (winnerIds.has(player.id)) {
        user.totalWins += 1;
        user.winStreak += 1;
        user.quests.win = true;
        this.credit(player.id, 'chips', 50, 'match_win', `match:${game.id}:${player.id}:win`);
      } else if (game.durak && game.durak.id === player.id) {
        user.winStreak = 0;
      }
    }
    this.persist();
  }

  createPayOrder(vkId, skuId) {
    const sku = VKPAY_SKUS[skuId];
    if (!sku) return { success: false, error: 'Неизвестный пакет' };
    const order = {
      id: crypto.randomUUID(),
      userId: vkId,
      sku: sku.id,
      priceRub: sku.priceRub,
      chips: sku.chips,
      vipDays: sku.vipDays,
      status: 'pending',
      createdAt: this.now()
    };
    this.store.data.orders.push(order);
    this.store.data.analytics.payOrders += 1;
    this.persist();
    return { success: true, order };
  }

  nextAppOrderId() {
    this.store.data.orderSeq = (this.store.data.orderSeq || 0) + 1;
    return this.store.data.orderSeq;
  }

  findVkOrder(orderId, test) {
    const vkOrderId = String(orderId);
    const mode = test ? 'test' : 'live';
    return this.store.data.orders.find((order) => order.vkOrderId === vkOrderId && order.mode === mode) || null;
  }

  fulfillVkOrder({ userId, orderId, skuId, test = false }) {
    const sku = VKPAY_SKUS[skuId];
    if (!sku) return { success: false, error: 'Неизвестный пакет' };
    if (!/^\d+$/.test(String(userId))) return { success: false, error: 'Нет user_id' };
    const vkId = `vk_${userId}`;
    const mode = test ? 'test' : 'live';
    const key = `vkpay:${mode}:${orderId}`;
    const existing = this.findLedger(key);
    if (existing) {
      const order = this.findVkOrder(orderId, test);
      return {
        success: true,
        duplicate: true,
        appOrderId: order?.appOrderId || 0,
        user: this.toClient(this.getUser(vkId)),
        order
      };
    }

    let order = this.findVkOrder(orderId, test);
    if (!order) {
      order = {
        id: crypto.randomUUID(),
        appOrderId: this.nextAppOrderId(),
        vkOrderId: String(orderId),
        userId: vkId,
        sku: sku.id,
        priceRub: sku.priceRub,
        priceVotes: sku.priceVotes,
        chips: sku.chips,
        gold: sku.gold || 0,
        vipDays: sku.vipDays || 0,
        status: 'pending',
        mode,
        test: Boolean(test),
        createdAt: this.now()
      };
      this.store.data.orders.push(order);
    }

    this.credit(vkId, 'chips', sku.chips, 'vkpay', `${key}:chips`, { silent: true, sku: sku.id, orderId: String(orderId) });
    if (sku.gold) this.credit(vkId, 'gold', sku.gold, 'vkpay', `${key}:gold`, { silent: true, sku: sku.id });
    const user = this.getUser(vkId);
    if (sku.vipDays) {
      const base = Math.max(this.now(), user.vipUntil || 0);
      user.vipUntil = base + sku.vipDays * DAY_MS;
    }
    this.store.data.ledger.push({
      id: crypto.randomUUID(),
      userId: vkId,
      type: 'vkpay_order',
      currency: 'chips',
      delta: 0,
      balanceAfter: user.chips,
      key,
      createdAt: this.now(),
      meta: { sku: sku.id, votes: sku.priceVotes }
    });
    order.status = 'paid';
    order.paidAt = this.now();
    this.store.data.analytics.payFulfilled += 1;
    this.persist();
    return {
      success: true,
      duplicate: false,
      appOrderId: order.appOrderId,
      user: this.toClient(user),
      order
    };
  }

  refundVkOrder({ userId, orderId, test = false }) {
    const vkId = `vk_${userId}`;
    const mode = test ? 'test' : 'live';
    const fulfillKey = `vkpay:${mode}:${orderId}`;
    const refundKey = `vkpay-refund:${mode}:${orderId}`;
    const order = this.findVkOrder(orderId, test);
    const existingRefund = this.findLedger(refundKey);
    if (existingRefund) {
      return { success: true, duplicate: true, appOrderId: order?.appOrderId || 0 };
    }
    if (!this.findLedger(fulfillKey) && !order) {
      return { success: true, duplicate: false, appOrderId: 0 };
    }
    const sku = VKPAY_SKUS[order?.sku];
    if (sku?.chips) this.credit(vkId, 'chips', -sku.chips, 'vkpay_refund', `${refundKey}:chips`, { silent: true });
    if (sku?.gold) this.credit(vkId, 'gold', -sku.gold, 'vkpay_refund', `${refundKey}:gold`, { silent: true });
    this.store.data.ledger.push({
      id: crypto.randomUUID(),
      userId: vkId,
      type: 'vkpay_refund',
      currency: 'chips',
      delta: sku ? -sku.chips : 0,
      balanceAfter: this.getUser(vkId).chips,
      key: refundKey,
      createdAt: this.now(),
      meta: { orderId: String(orderId) }
    });
    if (order) order.status = 'refunded';
    this.persist();
    return { success: true, duplicate: false, appOrderId: order?.appOrderId || 0 };
  }

  getMetrics() {
    const users = Object.values(this.store.data.users);
    const today = utcDay(this.now());
    const yesterday = today - 1;
    const dau = users.filter(user => utcDay(user.lastSeen) === today).length;
    const d1 = users.filter(user => utcDay(user.firstSeen) === yesterday && utcDay(user.lastSeen) === today).length;
    const a = this.store.data.analytics;
    return {
      users: users.length,
      dau,
      d1,
      matchesStarted: a.matchesStarted,
      matchesCompleted: a.matchesCompleted,
      shopPurchases: a.shopPurchases,
      rewardedClaims: a.rewardedClaims,
      payOrders: a.payOrders,
      payFulfilled: a.payFulfilled || 0,
      payConversion: users.length ? (a.payFulfilled || 0) / users.length : 0,
      generatedAt: this.now()
    };
  }
}

module.exports = {
  EconomyService,
  SKINS_CATALOG,
  VKPAY_SKUS,
  STARTER,
  QUESTS,
  REWARDED_DAILY_CAP,
  REWARDED_COOLDOWN_MS,
  REWARDED_CHIPS,
  DAILY_STREAK,
  resolveEconomyFile
};
