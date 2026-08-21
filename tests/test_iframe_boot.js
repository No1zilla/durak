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

function readBootState() {
  return {
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
  };
}

async function assertBooted(state, label) {
  if (state.boot && state.boot.includes('error')) {
    throw new Error(`${label}: boot failed: ${state.bootText}`);
  }
  if (!state.boot || !state.boot.includes('hidden')) {
    throw new Error(`${label}: boot did not hide: ${state.boot} ${state.bootText}`);
  }
  if (!state.socket?.connected) {
    throw new Error(`${label}: socket did not connect`);
  }
}

async function probeBlockedStorage(browser, url) {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  const cons = [];
  page.on('console', msg => cons.push({ type: msg.type(), text: msg.text() }));
  page.on('pageerror', err => cons.push({ type: 'pageerror', text: err.message }));
  await page.evaluateOnNewDocument(() => {
    const deny = () => {
      throw new DOMException('Access is denied for this document.', 'SecurityError');
    };
    Object.defineProperty(window, 'localStorage', { configurable: true, get: deny });
    Object.defineProperty(window, 'sessionStorage', { configurable: true, get: deny });
  });
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 25000 });
  await page.waitForFunction(
    () => document.getElementById('boot-screen')?.classList.contains('hidden')
      || document.getElementById('boot-screen')?.classList.contains('error'),
    { timeout: 12000 }
  );
  const state = await page.evaluate(readBootState);
  await page.close();
  return { state, cons };
}

async function probeIframe(browser, url) {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  const cons = [];
  page.on('console', msg => cons.push({ type: msg.type(), text: msg.text() }));
  page.on('pageerror', err => cons.push({ type: 'pageerror', text: err.message }));
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
  await page.evaluate((src) => {
    document.documentElement.innerHTML = `<iframe id="app" src="${src}" style="width:390px;height:844px;border:0"></iframe>`;
  }, url);
  const started = Date.now();
  let frame = null;
  while (Date.now() - started < 10000) {
    frame = page.frames().find(f => f !== page.mainFrame() && f.url() && f.url() !== 'about:blank');
    if (frame) break;
    await delay(200);
  }
  if (!frame) {
    const urls = page.frames().map(f => f.url());
    await page.close();
    throw new Error(`iframe did not load ${url}; frames=${urls.join(',')}`);
  }
  await delay(5000);
  const state = await frame.evaluate(readBootState);
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
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--disable-features=BlockInsecurePrivateNetworkRequests'
    ]
  });

  try {
    const blocked = await probeBlockedStorage(browser, serverUrl);
    console.log(JSON.stringify({ label: 'blocked-storage', serverUrl, ...blocked }, null, 2));
    await assertBooted(blocked.state, 'blocked-storage');
    if (!blocked.state.storageThrew) {
      throw new Error('blocked-storage probe did not throw on localStorage');
    }

    const iframe = await probeIframe(browser, serverUrl);
    console.log(JSON.stringify({ label: 'iframe', serverUrl, ...iframe }, null, 2));
    await assertBooted(iframe.state, 'iframe');
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
