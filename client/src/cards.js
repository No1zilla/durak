/**
 * cards.js - High-Resolution Card Texture Generator with Asset Loader
 */

export const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];

export const SUIT_SYMBOLS = {
  hearts: '♥',
  diamonds: '♦',
  clubs: '♣',
  spades: '♠'
};

export const SUIT_COLORS = {
  hearts: '#e11d48',
  diamonds: '#e11d48',
  clubs: '#0f172a',
  spades: '#0f172a'
};

export const RANK_LABELS = {
  2: '2', 3: '3', 4: '4', 5: '5',
  6: '6', 7: '7', 8: '8', 9: '9', 10: '10',
  11: 'J', 12: 'Q', 13: 'K', 14: 'A'
};

const cardTextureCache = new Map();
const textureLoader = new THREE.TextureLoader();

/**
 * Creates an ultra-crisp Three.js CanvasTexture for a card front face
 */
export function createCardFaceTexture(suit, rank) {
  const cacheKey = `face_${suit}_${rank}`;
  if (cardTextureCache.has(cacheKey)) {
    return cardTextureCache.get(cacheKey);
  }

  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 716;
  const ctx = canvas.getContext('2d');

  // Background - Ivory White with subtle paper texture
  ctx.fillStyle = '#fcfcfa';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Border & Inset Gold hairline
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 4;
  ctx.strokeRect(12, 12, canvas.width - 24, canvas.height - 24);

  ctx.strokeStyle = 'rgba(212, 175, 55, 0.45)';
  ctx.lineWidth = 2;
  ctx.strokeRect(20, 20, canvas.width - 40, canvas.height - 40);

  const color = SUIT_COLORS[suit];
  const symbol = SUIT_SYMBOLS[suit];
  const label = RANK_LABELS[rank] || rank;

  // Draw Corner Top-Left
  ctx.fillStyle = color;
  ctx.font = 'bold 54px Outfit, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(label, 36, 80);

  ctx.font = '50px Inter, sans-serif';
  ctx.fillText(symbol, 38, 134);

  // Draw Corner Bottom-Right (Rotated 180)
  ctx.save();
  ctx.translate(canvas.width - 36, canvas.height - 80);
  ctx.rotate(Math.PI);
  ctx.fillText(label, -18, 0);
  ctx.font = '50px Inter, sans-serif';
  ctx.fillText(symbol, -16, 54);
  ctx.restore();

  // Draw Center Art
  ctx.save();
  ctx.translate(canvas.width / 2, canvas.height / 2);

  if (rank >= 11 && rank <= 13) {
    drawCourtCardArt(ctx, rank, suit, color);
  } else if (rank === 14) {
    ctx.fillStyle = color;
    ctx.font = 'bold 190px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(symbol, 0, -10);

    ctx.strokeStyle = 'rgba(212, 175, 55, 0.6)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, 150, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    drawPips(ctx, rank, symbol, color);
  }
  ctx.restore();

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  cardTextureCache.set(cacheKey, texture);
  return texture;
}

function drawCourtCardArt(ctx, rank, suit, color) {
  ctx.strokeStyle = 'rgba(212, 175, 55, 0.85)';
  ctx.lineWidth = 4;
  ctx.strokeRect(-140, -200, 280, 400);

  ctx.fillStyle = 'rgba(245, 245, 235, 0.65)';
  ctx.fillRect(-136, -196, 272, 392);

  ctx.fillStyle = color;
  ctx.font = 'bold 110px Cinzel, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const courtTitles = { 11: 'JACK', 12: 'QUEEN', 13: 'KING' };
  ctx.fillText(RANK_LABELS[rank], 0, -30);

  ctx.font = '60px Inter, sans-serif';
  ctx.fillText(SUIT_SYMBOLS[suit], 0, 60);

  ctx.font = '600 18px Outfit, sans-serif';
  ctx.fillStyle = '#64748b';
  ctx.fillText(courtTitles[rank], 0, 130);
}

function drawPips(ctx, count, symbol, color) {
  ctx.fillStyle = color;
  ctx.font = '76px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const positions = {
    6: [[-60, -110], [60, -110], [-60, 0], [60, 0], [-60, 110], [60, 110]],
    7: [[-60, -110], [60, -110], [0, -50], [-60, 0], [60, 0], [-60, 110], [60, 110]],
    8: [[-60, -120], [60, -120], [0, -60], [-60, 0], [60, 0], [0, 60], [-60, 120], [60, 120]],
    9: [[-60, -130], [60, -130], [-60, -40], [60, -40], [0, 0], [-60, 40], [60, 40], [-60, 130], [60, 130]],
    10: [[-60, -140], [60, -140], [0, -90], [-60, -30], [60, -30], [-60, 30], [60, 30], [0, 90], [-60, 140], [60, 140]]
  };

  const pips = positions[count] || [[0, 0]];
  for (const [x, y] of pips) {
    ctx.fillText(symbol, x, y);
  }
}

/**
 * Loads or Generates Card Back Skin Texture
 */
export function createCardBackTexture(skinId = 'deck_classic') {
  const cacheKey = `back_${skinId}`;
  if (cardTextureCache.has(cacheKey)) {
    return cardTextureCache.get(cacheKey);
  }

  // Load from asset directory
  const assetPaths = {
    deck_classic: 'assets/cards/back_classic.svg',
    deck_imperial: 'assets/cards/back_imperial.svg'
  };

  if (assetPaths[skinId]) {
    const tex = textureLoader.load(assetPaths[skinId]);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    cardTextureCache.set(cacheKey, tex);
    return tex;
  }

  // Fallback for gold / cyberpunk
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 716;
  const ctx = canvas.getContext('2d');

  if (skinId === 'deck_gold') {
    const grad = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    grad.addColorStop(0, '#f59e0b');
    grad.addColorStop(0.5, '#d97706');
    grad.addColorStop(1, '#b45309');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 4;
    ctx.strokeRect(24, 24, canvas.width - 48, canvas.height - 48);

    ctx.font = '80px Cinzel, serif';
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.fillText('VIP', canvas.width / 2, canvas.height / 2 + 25);
  } else {
    ctx.fillStyle = '#090d16';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = '#06b6d4';
    ctx.lineWidth = 6;
    ctx.strokeRect(20, 20, canvas.width - 40, canvas.height - 40);

    ctx.font = 'bold 36px Outfit, sans-serif';
    ctx.fillStyle = '#06b6d4';
    ctx.textAlign = 'center';
    ctx.fillText('CYBER DURAK', canvas.width / 2, canvas.height / 2 + 10);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  cardTextureCache.set(cacheKey, texture);
  return texture;
}
