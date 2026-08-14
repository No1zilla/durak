/**
 * Deck.js - Card deck generator & shuffler for Durak Online 3D
 */

const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];

const SUIT_SYMBOLS = {
  hearts: '♥',
  diamonds: '♦',
  clubs: '♣',
  spades: '♠'
};

const SUIT_COLORS = {
  hearts: 'red',
  diamonds: 'red',
  clubs: 'black',
  spades: 'black'
};

const RANK_LABELS = {
  2: '2', 3: '3', 4: '4', 5: '5',
  6: '6', 7: '7', 8: '8', 9: '9', 10: '10',
  11: 'J', 12: 'Q', 13: 'K', 14: 'A'
};

class Deck {
  constructor(size = 36) {
    this.size = [24, 36, 52].includes(size) ? size : 36;
    this.cards = [];
    this.trumpCard = null;
    this.trumpSuit = null;
    this.init();
  }

  init() {
    let minRank = 6;
    if (this.size === 24) minRank = 9;
    if (this.size === 52) minRank = 2;

    this.cards = [];
    for (const suit of SUITS) {
      for (let rank = minRank; rank <= 14; rank++) {
        const id = `${suit[0].toUpperCase()}_${rank}`;
        this.cards.push({
          id,
          suit,
          rank,
          symbol: SUIT_SYMBOLS[suit],
          color: SUIT_COLORS[suit],
          label: RANK_LABELS[rank]
        });
      }
    }

    this.shuffle();

    // The bottom card is the trump card
    if (this.cards.length > 0) {
      this.trumpCard = { ...this.cards[0] };
      this.trumpSuit = this.trumpCard.suit;
    }
  }

  shuffle() {
    for (let i = this.cards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.cards[i], this.cards[j]] = [this.cards[j], this.cards[i]];
    }
  }

  draw(count = 1) {
    const drawn = [];
    for (let i = 0; i < count; i++) {
      if (this.cards.length > 0) {
        drawn.push(this.cards.pop());
      }
    }
    return drawn;
  }

  get remaining() {
    return this.cards.length;
  }
}

module.exports = { Deck, SUITS, SUIT_SYMBOLS, SUIT_COLORS, RANK_LABELS };
