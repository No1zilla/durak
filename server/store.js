const fs = require('fs');
const path = require('path');

class JsonStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.tmpPath = `${filePath}.tmp`;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    this.data = this.read();
  }

  read() {
    try {
      return JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
    } catch {
      return { users: {}, ledger: [], orders: [], analytics: { matchesStarted: 0, matchesCompleted: 0, shopPurchases: 0, rewardedClaims: 0, payOrders: 0 } };
    }
  }

  write() {
    fs.writeFileSync(this.tmpPath, JSON.stringify(this.data));
    fs.renameSync(this.tmpPath, this.filePath);
  }
}

module.exports = { JsonStore };
