/**
 * storyShare.js - Canvas-Based 1080x1920 High-Res Story Card Generator for VK
 */

export async function generateStoryImage({ player, reward = 1500, streak = 5, matchTime = '04:12', mode = 'Подкидной' }) {
  const canvas = document.createElement('canvas');
  canvas.width = 1080;
  canvas.height = 1920;
  const ctx = canvas.getContext('2d');

  // 1. Deep Obsidian & Dark Forest Green Velvet Background
  const bgGrad = ctx.createRadialGradient(540, 960, 200, 540, 960, 1100);
  bgGrad.addColorStop(0, '#0d281e');
  bgGrad.addColorStop(0.6, '#06130e');
  bgGrad.addColorStop(1, '#020604');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Subtle ambient glow
  const glowGrad = ctx.createRadialGradient(540, 650, 50, 540, 650, 400);
  glowGrad.addColorStop(0, 'rgba(212, 175, 55, 0.15)');
  glowGrad.addColorStop(1, 'transparent');
  ctx.fillStyle = glowGrad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // 2. Glassmorphism Card in Center
  const cardX = 140;
  const cardY = 480;
  const cardW = 800;
  const cardH = 960;
  const radius = 48;

  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
  ctx.shadowBlur = 60;
  ctx.shadowOffsetY = 30;

  // Frosted Glass Fill
  ctx.fillStyle = 'rgba(18, 26, 36, 0.82)';
  roundRect(ctx, cardX, cardY, cardW, cardH, radius);
  ctx.fill();
  ctx.restore();

  // Glass Border Inset
  ctx.strokeStyle = 'rgba(212, 175, 55, 0.4)';
  ctx.lineWidth = 3;
  roundRect(ctx, cardX, cardY, cardW, cardH, radius);
  ctx.stroke();

  // 3. Draw Player Avatar in Center Top of Card
  const avatarSize = 160;
  const avatarX = 540;
  const avatarY = cardY + 110;

  try {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    await new Promise((resolve) => {
      img.onload = resolve;
      img.onerror = resolve;
      img.src = player.avatar || '';
    });

    ctx.save();
    ctx.beginPath();
    ctx.arc(avatarX, avatarY, avatarSize / 2, 0, Math.PI * 2);
    ctx.clip();
    if (img.complete && img.naturalWidth > 0) {
      ctx.drawImage(img, avatarX - avatarSize / 2, avatarY - avatarSize / 2, avatarSize, avatarSize);
    } else {
      ctx.fillStyle = '#1e3a8a';
      ctx.fillRect(avatarX - avatarSize / 2, avatarY - avatarSize / 2, avatarSize, avatarSize);
    }
    ctx.restore();

    // Gold Ring around Avatar
    ctx.strokeStyle = '#d4af37';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(avatarX, avatarY, avatarSize / 2, 0, Math.PI * 2);
    ctx.stroke();
  } catch (e) {}

  // 4. Player Name
  ctx.fillStyle = '#9ca3af';
  ctx.font = '600 36px Outfit, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(player.name || 'Игрок', 540, cardY + 240);

  // 5. Title "ПОБЕДА"
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 80px Cinzel, serif';
  ctx.fillText('ПОБЕДА', 540, cardY + 340);

  ctx.fillStyle = '#64748b';
  ctx.font = '500 30px Outfit, sans-serif';
  ctx.fillText(`${mode} Дурак • 3D Онлайн`, 540, cardY + 400);

  // Divider Line
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cardX + 60, cardY + 460);
  ctx.lineTo(cardX + cardW - 60, cardY + 460);
  ctx.stroke();

  // 6. Stats Grid (3 Columns)
  const colY = cardY + 540;
  const col1X = cardX + 140;
  const col2X = 540;
  const col3X = cardX + cardW - 140;

  // Stat 1: Reward Chips
  ctx.fillStyle = '#f59e0b';
  ctx.font = 'bold 44px Outfit, sans-serif';
  ctx.fillText(`+${reward}`, col1X, colY);
  ctx.fillStyle = '#94a3b8';
  ctx.font = '500 24px Outfit, sans-serif';
  ctx.fillText('фишек 🪙', col1X, colY + 45);

  // Stat 2: Streak
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 44px Outfit, sans-serif';
  ctx.fillText(`${streak}`, col2X, colY);
  ctx.fillStyle = '#94a3b8';
  ctx.font = '500 24px Outfit, sans-serif';
  ctx.fillText('побед подряд 🔥', col2X, colY + 45);

  // Stat 3: Match Time
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 44px Outfit, sans-serif';
  ctx.fillText(matchTime, col3X, colY);
  ctx.fillStyle = '#94a3b8';
  ctx.font = '500 24px Outfit, sans-serif';
  ctx.fillText('время матча ⏱', col3X, colY + 45);

  // 7. Footer Branding
  ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
  ctx.font = '600 28px Outfit, sans-serif';
  ctx.fillText('Играй в VK: vk.com/app54720415', 540, cardY + 840);

  return canvas.toDataURL('image/png');
}

function roundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}
