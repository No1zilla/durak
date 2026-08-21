const fs = require('fs');
const path = require('path');

class JsonStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.tmpPath = `${filePath}.tmp`;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    this.data = this.read();
  }

  empty() {
    return {
      users: {},
      ledger: [],
      orders: [],
      orderSeq: 0,
      analytics: {
        matchesStarted: 0,
        matchesCompleted: 0,
        shopPurchases: 0,
        rewardedClaims: 0,
        payOrders: 0,
        payFulfilled: 0
      }
    };
  }

  read() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      const empty = this.empty();
      parsed.users = parsed.users || {};
      parsed.ledger = parsed.ledger || [];
      parsed.orders = parsed.orders || [];
      parsed.orderSeq = Number(parsed.orderSeq) || 0;
      parsed.analytics = { ...empty.analytics, ...(parsed.analytics || {}) };
      return parsed;
    } catch {
      return this.empty();
    }
  }

  write() {
    fs.writeFileSync(this.tmpPath, JSON.stringify(this.data));
    fs.renameSync(this.tmpPath, this.filePath);
  }
}

module.exports = { JsonStore };
