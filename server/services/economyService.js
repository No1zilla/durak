const path = require('path');
const crypto = require('crypto');
const { JsonStore } = require('../store');

const DAY_MS = 24 * 60 * 60 * 1000;
const REWARDED_DAILY_CAP = 3;
const DEFAULT_FILE = path.join(__dirname, '../../data/state.json');

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
  chips_10k: { id: 'chips_10k', name: '10,000 Фишек', priceRub: 99, chips: 10000, vipDays: 0 },
  chips_50k_vip: { id: 'chips_50k_vip', name: '50,000 Фишек + VIP', priceRub: 299, chips: 50000, vipDays: 30 },
  chips_150k: { id: 'chips_150k', name: '150,000 Фишек (Хит)', priceRub: 699, chips: 150000, vipDays: 0 }
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
    this.store = new JsonStore(options.filePath || process.env.ECONOMY_FILE || DEFAULT_FILE);
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

  claimRewardedAd(vkId) {
    const user = this.getUser(vkId);
    const day = utcDay(this.now());
    if (user.rewardedDay !== day) {
      user.rewardedDay = day;
      user.rewardedCount = 0;
    }
    if (user.rewardedCount >= REWARDED_DAILY_CAP) {
      return { success: false, error: 'Лимит рекламы на сегодня исчерпан' };
    }
    user.rewardedCount += 1;
    this.store.data.analytics.rewardedClaims += 1;
    this.credit(vkId, 'chips', 400, 'rewarded', `rewarded:${vkId}:${day}:${user.rewardedCount}`);
    this.persist();
    return { success: true, reward: { chips: 400 }, user: this.toClient(user) };
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
      payConversion: users.length ? a.payOrders / users.length : 0,
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
  DAILY_STREAK
};
