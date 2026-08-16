/**
 * test_visual.js — Puppeteer visual test: opens page, takes screenshots of lobby + gameplay
 */
const puppeteer = require('puppeteer');
const path = require('path');

const SERVER = 'http://localhost:3000';
const SCREENSHOT_DIR = path.join(__dirname, '../screenshots');
const delay = ms => new Promise(r => setTimeout(r, ms));

async function run() {
  console.log('\n📸 Visual Test — Puppeteer Screenshots\n');

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    defaultViewport: { width: 414, height: 896, deviceScaleFactor: 2 } // iPhone XR
  });

  const page = await browser.newPage();

  // Collect console errors
  const errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', err => errors.push(err.message));

  try {
    // 1. Load page
    console.log('  1. Loading page...');
    await page.goto(SERVER, { waitUntil: 'networkidle2', timeout: 15000 });
    await delay(3000); // Let Three.js render

    // Screenshot 1: Lobby
    const lobbyPath = path.join(SCREENSHOT_DIR, '01_lobby.png');
    await page.screenshot({ path: lobbyPath, fullPage: false });
    console.log(`  ✅ Lobby screenshot: ${lobbyPath}`);

    // 2. Check if canvas rendered
    const hasCanvas = await page.evaluate(() => {
      const canvas = document.querySelector('#canvas-container canvas');
      return canvas ? { w: canvas.width, h: canvas.height } : null;
    });
    console.log(`  Canvas: ${hasCanvas ? `${hasCanvas.w}x${hasCanvas.h}` : '❌ NOT FOUND'}`);
    if (!hasCanvas) throw new Error('WebGL canvas not found');

    // Check for WebGL context
    const hasWebGL = await page.evaluate(() => {
      const canvas = document.querySelector('#canvas-container canvas');
      if (!canvas) return false;
      const gl = canvas.getContext('webgl') || canvas.getContext('webgl2');
      return !!gl;
    });
    console.log(`  WebGL: ${hasWebGL ? '✅' : '⚠️ context already in use by Three.js (expected)'}`);

    // 3. Click Quick Play
    console.log('  2. Clicking "Подкидной" quick play...');
    const btnExists = await page.evaluate(() => {
      const btn = document.getElementById('btn-quick-podkidnoy');
      return btn ? true : false;
    });

    if (btnExists) {
      await page.click('#btn-quick-podkidnoy');
      console.log('  ✅ Button clicked');
      await delay(5000); // Wait for game to start + bots

      // Screenshot 2: Game in progress
      const gamePath = path.join(SCREENSHOT_DIR, '02_game_playing.png');
      await page.screenshot({ path: gamePath, fullPage: false });
      console.log(`  ✅ Game screenshot: ${gamePath}`);

      // 4. Check game HUD elements
      const hudCheck = await page.evaluate(() => {
        const results = {};
        results.gameHudVisible = document.getElementById('game-hud')?.classList.contains('active') || false;
        results.trumpText = document.getElementById('hud-deck-count')?.textContent || '';
        results.modeText = document.getElementById('hud-game-mode')?.textContent || '';
        results.promptText = document.getElementById('action-prompt')?.textContent || '';
        results.timerText = document.getElementById('hud-timer-text')?.textContent || '';
        results.seatBadges = document.querySelectorAll('.seat-badge-3d').length;
        return results;
      });

      console.log(`  HUD visible: ${hudCheck.gameHudVisible ? '✅' : '❌'}`);
      console.log(`  Trump: ${hudCheck.trumpText || '❌'}`);
      console.log(`  Mode: ${hudCheck.modeText || '❌'}`);
      console.log(`  Prompt: ${hudCheck.promptText || '❌'}`);
      console.log(`  Timer: ${hudCheck.timerText || '❌'}`);
      console.log(`  Seat badges: ${hudCheck.seatBadges}`);

      // 5. Check 3D scene objects
      const sceneCheck = await page.evaluate(() => {
        if (!window.app || !window.app.scene3D) return { error: 'app not ready' };
        const scene = window.app.scene3D.scene;
        return {
          childCount: scene.children.length,
          hasCamera: !!window.app.scene3D.camera,
          hasRenderer: !!window.app.scene3D.renderer,
          cameraPos: window.app.scene3D.camera ? {
            x: window.app.scene3D.camera.position.x.toFixed(2),
            y: window.app.scene3D.camera.position.y.toFixed(2),
            z: window.app.scene3D.camera.position.z.toFixed(2)
          } : null
        };
      });

      console.log(`  3D Scene children: ${sceneCheck.childCount || sceneCheck.error}`);
      console.log(`  Camera: ${sceneCheck.hasCamera ? '✅' : '❌'} pos=${JSON.stringify(sceneCheck.cameraPos)}`);
      console.log(`  Renderer: ${sceneCheck.hasRenderer ? '✅' : '❌'}`);
      if (!sceneCheck.hasRenderer) throw new Error('WebGL renderer not available');

      // 6. Check card meshes
      const cardCheck = await page.evaluate(() => {
        if (!window.app || !window.app.cardRenderer) return { error: 'cardRenderer not ready' };
        return {
          totalMeshes: window.app.cardRenderer.cardMeshes.size,
          handCards: window.app.cardRenderer.handCards.length,
          opponentMeshes: window.app.cardRenderer.opponentCardMeshes.length,
          deckMeshes: window.app.cardRenderer.deckMeshes.length
        };
      });

      console.log(`  Card meshes total: ${cardCheck.totalMeshes ?? cardCheck.error}`);
      console.log(`  Hand cards: ${cardCheck.handCards ?? '?'}`);
      console.log(`  Opponent meshes: ${cardCheck.opponentMeshes ?? '?'}`);
      console.log(`  Deck meshes: ${cardCheck.deckMeshes ?? '?'}`);

      // Wait a bit more for any animations, take final screenshot
      await delay(2000);
      const finalPath = path.join(SCREENSHOT_DIR, '03_game_after_bots.png');
      await page.screenshot({ path: finalPath, fullPage: false });
      console.log(`  ✅ Final screenshot: ${finalPath}`);
    } else {
      console.log('  ❌ Quick play button not found!');
    }

    // Report errors
    if (errors.length > 0) {
      console.log(`\n  ⚠️ Console errors (${errors.length}):`);
      errors.forEach(e => console.log(`    • ${e}`));
      throw new Error(`Browser reported ${errors.length} console error(s)`);
    } else {
      console.log('\n  ✅ No console errors!');
    }

  } catch (err) {
    console.error(`  ❌ Error: ${err.message}`);
    process.exitCode = 1;
  } finally {
    await browser.close();
    console.log('\n📸 Done.\n');
  }
}

run();
