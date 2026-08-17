/**
 * economyService.js - In-game economy, chip balances, daily bonus, and 3D skin inventory
 */

const SKINS_CATALOG = {
  decks: [
    { id: 'deck_classic', name: 'Классический Атласный', priceCoins: 0, priceGold: 0, rarity: 'common' },
    { id: 'deck_imperial', name: 'Императорский 1913', priceCoins: 2500, priceGold: 50, rarity: 'rare' },
    { id: 'deck_cyberpunk', name: 'Киберпанк Неон', priceCoins: 5000, priceGold: 100, rarity: 'epic' },
    { id: 'deck_gold', name: 'Золотой Век (Foil)', priceCoins: 10000, priceGold: 200, rarity: 'legendary' }
  ],
  tables: [
    { id: 'table_emerald', name: 'Изумрудный Бархат', priceCoins: 0, priceGold: 0, color: '#114227' },
    { id: 'table_red', name: 'Винный Барокко', priceCoins: 3000, priceGold: 60, color: '#4a111a' },
    { id: 'table_carbon', name: 'Карбон & Неон', priceCoins: 6000, priceGold: 120, color: '#161a22' },
    { id: 'table_marble', name: 'Королевский Мрамор', priceCoins: 12000, priceGold: 250, color: '#0d2238' }
  ]
};

class EconomyService {
  constructor() {
    this.users = new Map(); // vkId -> { chips, gold, ownedDecks, ownedTables, activeDeck, activeTable, lastDailyClaim }
  }

  getUser(vkId) {
    if (!this.users.has(vkId)) {
      this.users.set(vkId, {
        vkId,
        chips: 5000,
        gold: 50,
        ownedDecks: ['deck_classic'],
        ownedTables: ['table_emerald'],
        activeDeck: 'deck_classic',
        activeTable: 'table_emerald',
        lastDailyClaim: null,
        winStreak: 0,
        totalWins: 0,
        totalGames: 0
      });
    }
    return this.users.get(vkId);
  }

  claimDailyReward(vkId) {
    const user = this.getUser(vkId);
    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000;

    if (user.lastDailyClaim && (now - user.lastDailyClaim < oneDay)) {
      const remainingMs = oneDay - (now - user.lastDailyClaim);
      const remainingHours = Math.ceil(remainingMs / (60 * 60 * 1000));
      return { success: false, error: `Следующая награда через ${remainingHours} ч.` };
    }

    const rewardChips = 1500;
    const rewardGold = 10;
    user.chips += rewardChips;
    user.gold += rewardGold;
    user.lastDailyClaim = now;

    return { success: true, reward: { chips: rewardChips, gold: rewardGold }, user };
  }

  buySkin(vkId, category, skinId, useCurrency = 'chips') {
    const user = this.getUser(vkId);
    const catalog = category === 'tables' ? SKINS_CATALOG.tables : SKINS_CATALOG.decks;
    const item = catalog.find(i => i.id === skinId);

    if (!item) return { success: false, error: 'Товар не найден' };

    const ownedList = category === 'tables' ? user.ownedTables : user.ownedDecks;
    if (ownedList.includes(skinId)) {
      return { success: false, error: 'Предмет уже куплен' };
    }

    if (useCurrency === 'gold') {
      if (user.gold < item.priceGold) return { success: false, error: 'Недостаточно золота' };
      user.gold -= item.priceGold;
    } else {
      if (user.chips < item.priceCoins) return { success: false, error: 'Недостаточно фишек' };
      user.chips -= item.priceCoins;
    }

    ownedList.push(skinId);
    return { success: true, user, item };
  }

  equipSkin(vkId, category, skinId) {
    const user = this.getUser(vkId);
    const ownedList = category === 'tables' ? user.ownedTables : user.ownedDecks;
    if (!ownedList.includes(skinId)) return { success: false, error: 'Скин не куплен' };

    if (category === 'tables') {
      user.activeTable = skinId;
    } else {
      user.activeDeck = skinId;
    }

    return { success: true, user };
  }

}

module.exports = { EconomyService, SKINS_CATALOG };
