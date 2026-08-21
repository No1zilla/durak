/**
 * test_iframe_boot.js — VK desktop is a third-party iframe; localStorage is often blocked.
 * Boot must still hide after Socket.IO auth.
 */
const puppeteer = require('puppeteer');
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

const delay = ms => new Promise(r => setTimeout(r, ms));

function waitForHttp(url, timeoutMs = 20000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      http.get(url, res => {
        res.resume();
        resolve();
      }).on('error', () => {
        if (Date.now() - started > timeoutMs) reject(new Error(`timeout waiting for ${url}`));
        else setTimeout(tick, 150);
      });
    };
    tick();
  });
}

async function probeIframe(browser, url) {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  const cons = [];
  page.on('console', msg => cons.push({ type: msg.type(), text: msg.text() }));
  page.on('pageerror', err => cons.push({ type: 'pageerror', text: err.message }));
  await page.setContent(
    `<!doctype html><iframe id="app" src="${url}" style="width:390px;height:844px;border:0"></iframe>`,
    { waitUntil: 'networkidle2', timeout: 25000 }
  );
  await delay(6000);
  const frame = page.frames().find(f => f.url().includes(new URL(url).host));
  if (!frame) {
    await page.close();
    throw new Error(`iframe did not load ${url}`);
  }
  const state = await frame.evaluate(() => ({
    href: location.href,
    boot: document.getElementById('boot-screen')?.className,
    bootText: document.getElementById('boot-status')?.textContent,
    app: !!window.app,
    player: window.app?.player?.id || null,
    socket: window.app?.socket
      ? {
        connected: window.app.socket.connected,
        transport: window.app.socket.io?.engine?.transport?.name
      }
      : null,
    storageThrew: (() => {
      try {
        window.localStorage.getItem('x');
        return false;
      } catch {
        return true;
      }
    })()
  }));
  await page.close();
  return { state, cons };
}

async function main() {
  const requested = process.env.SERVER_URL;
  let child;
  let serverUrl = requested;
  if (!serverUrl) {
    const port = process.env.PORT || '3099';
    serverUrl = `http://127.0.0.1:${port}/`;
    child = spawn('node', ['server/server.js'], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, PORT: String(port), NODE_ENV: 'development' },
      stdio: 'inherit'
    });
    await waitForHttp(serverUrl);
  }

  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome-stable',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
  });

  try {
    const { state, cons } = await probeIframe(browser, serverUrl);
    console.log(JSON.stringify({ serverUrl, state, cons }, null, 2));
    if (state.boot && state.boot.includes('error')) {
      throw new Error(`boot failed in iframe: ${state.bootText}`);
    }
    if (!state.boot || !state.boot.includes('hidden')) {
      throw new Error(`boot did not hide in iframe: ${state.boot} ${state.bootText}`);
    }
    if (!state.socket?.connected) {
      throw new Error('socket did not connect in iframe');
    }
    console.log('iframe boot ok');
  } finally {
    await browser.close();
    if (child) child.kill('SIGTERM');
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
