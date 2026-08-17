/**
 * test_vk_smoke.js — Browser smoke: no CDN, boot, lobby, shop, hash auth, match, leave
 */
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const SERVER = process.env.SERVER_URL || 'http://localhost:3000';
const SCREENSHOT_DIR = path.join(__dirname, '../screenshots');
const delay = ms => new Promise(r => setTimeout(r, ms));

function assert(condition, label) {
  if (!condition) throw new Error(label);
}

async function run() {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    defaultViewport: { width: 390, height: 844, deviceScaleFactor: 2 }
  });
  const page = await browser.newPage();
  const errors = [];
  const blockedCdn = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', err => errors.push(err.message));
  page.on('request', req => {
    const url = req.url();
    if (/cdnjs\.cloudflare|unpkg\.com|fonts\.googleapis|fonts\.gstatic/.test(url)) {
      blockedCdn.push(url);
    }
  });

  try {
    const html = fs.readFileSync(path.join(__dirname, '../client/index.html'), 'utf8');
    assert(!/cdnjs|unpkg|fonts\.googleapis/.test(html), 'index.html still loads CDN assets');
    ['three.min.js', 'gsap.min.js', 'vk-bridge.min.js'].forEach(file => {
      assert(fs.existsSync(path.join(__dirname, '../client/vendor', file)), `missing vendor/${file}`);
    });

    await page.goto(SERVER, { waitUntil: 'networkidle2', timeout: 20000 });
    await page.waitForFunction(() => document.getElementById('boot-screen')?.classList.contains('hidden'), { timeout: 12000 });
    await delay(800);

    const lobby = await page.evaluate(() => ({
      three: typeof THREE !== 'undefined',
      gsap: typeof gsap !== 'undefined',
      canvas: !!document.querySelector('#canvas-container canvas'),
      lobby: document.getElementById('lobby-view')?.classList.contains('active'),
      name: document.getElementById('user-name')?.textContent,
      playerId: window.app?.player?.id || ''
    }));
    assert(lobby.three, 'THREE missing');
    assert(lobby.gsap, 'GSAP missing');
    assert(lobby.canvas, 'WebGL canvas missing');
    assert(lobby.lobby, 'Lobby not active');
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '05_vk_lobby.png') });

    await page.click('#btn-shop');
    await delay(400);
    const shopOpen = await page.evaluate(() => document.getElementById('modal-shop')?.classList.contains('active'));
    assert(shopOpen, 'Shop did not open');
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '06_vk_shop.png') });
    await page.click('#btn-close-shop');
    await delay(200);

    await page.click('#btn-quick-podkidnoy');
    await page.waitForFunction(() => document.getElementById('game-hud')?.classList.contains('active'), { timeout: 8000 });
    await delay(2500);
    const game = await page.evaluate(() => ({
      hud: document.getElementById('game-hud')?.classList.contains('active'),
      hand: window.app?.cardRenderer?.handCards?.length || 0,
      renderer: !!window.app?.scene3D?.renderer,
      prompt: document.getElementById('action-prompt')?.textContent || ''
    }));
    assert(game.hud, 'Game HUD not visible');
    assert(game.renderer, 'Renderer missing in match');
    assert(game.hand === 6, `Expected 6 cards, got ${game.hand}`);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '07_vk_match.png') });

    const cardPlayed = await page.evaluate(() => {
      const card = window.app?.cardRenderer?.handCards?.[0];
      if (!card) return false;
      window.app.handleCardPlay(card);
      return true;
    });
    assert(cardPlayed, 'Could not play a card');
    await delay(1200);

    await page.click('#btn-leave-game');
    await page.waitForFunction(() => document.getElementById('lobby-view')?.classList.contains('active'), { timeout: 5000 });

    await page.goto(`${SERVER}/#vk_user_id=4242&vk_app_id=54720415&sign=devsign`, { waitUntil: 'networkidle2', timeout: 15000 });
    await page.waitForFunction(() => window.app?.player?.id === 'guest_vk_4242', { timeout: 10000 });
    const hashAuth = await page.evaluate(() => window.app?.player?.id || '');
    assert(hashAuth === 'guest_vk_4242', `Hash auth id was ${hashAuth}`);

    await page.setViewport({ width: 896, height: 685, deviceScaleFactor: 1 });
    await delay(600);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '08_vk_desktop_lobby.png') });

    assert(blockedCdn.length === 0, `CDN requests: ${blockedCdn.join(', ')}`);
    const ignored = errors.filter(text => !/Failed to load resource/.test(text));
    if (ignored.length) throw new Error(`Console errors: ${ignored.join(' | ')}`);
    console.log('VK smoke passed', { player: lobby.name, hashAuth, hand: game.hand });
  } catch (err) {
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '99_vk_smoke_fail.png') }).catch(() => {});
    console.error(`VK smoke failed: ${err.message}`);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

run();
