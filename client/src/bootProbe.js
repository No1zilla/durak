/**
 * Classify VK/Russia boot failures. Imported by app.js and started from index.html.
 */
import {
  DEFAULT_PAGES_API,
  hostnameOf,
  isRailwayHost,
  isStaticHost,
  resolveApiOrigin
} from './apiOrigin.js';

export function classifyBootFailure({
  hostname = '',
  apiOrigin = '',
  htmlLoaded = true,
  healthOk,
  socketConnected,
  authError = '',
  webgl = true
} = {}) {
  const host = hostname || '';
  const apiHost = hostnameOf(apiOrigin) || (apiOrigin ? apiOrigin : host);

  if (authError) {
    return { code: 'vk_sign', message: String(authError) };
  }

  if (!htmlLoaded) {
    return {
      code: 'host_blocked',
      message: 'VK не открыл URL приложения. Не ставьте *.up.railway.app в кабинет — из РФ этот IP часто не отвечает.'
    };
  }

  if (healthOk === false) {
    if (isRailwayHost(host) || isRailwayHost(apiHost)) {
      return {
        code: 'railway_blocked',
        message: `Хост ${host}: API Railway не отвечает из этой сети (таймаут на 69.46.46.x). В кабинете VK нужен URL Cloudflare-прокси, не up.railway.app.`
      };
    }
    return {
      code: 'api_blocked',
      message: `Нет /api/health (${apiOrigin || host}). Проверьте DURAK_API_ORIGIN и прокси.`
    };
  }

  if (socketConnected === false) {
    if (isStaticHost(host) && isRailwayHost(apiHost)) {
      return {
        code: 'socket',
        message: `HTML с ${host} открылся, сокет на Railway не прошёл. VK WebView и сети РФ режут *.up.railway.app — нужен Cloudflare same-origin.`
      };
    }
    return {
      code: 'socket',
      message: `API жив, Socket.IO нет (${host}). Прокси должен пропускать /socket.io/ (polling + websocket).`
    };
  }

  if (webgl === false) {
    return { code: 'webgl', message: 'WebGL недоступен — плоский режим. На вход это не влияет.' };
  }

  if (isRailwayHost(host)) {
    return {
      code: 'timeout',
      message: `Нет входа за отведённое время (${host}). Из РФ *.up.railway.app часто недоступен. URL в кабинете VK — Cloudflare, не Railway.`
    };
  }

  return {
    code: 'timeout',
    message: `Нет входа за отведённое время (${host}). Если splash крутится без ошибки — сокет или подпись VK.`
  };
}

async function probePath(origin, pathname, timeoutMs) {
  const url = `${origin || ''}${pathname}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
    const data = await res.json().catch(() => ({}));
    const looksLikeApi = Boolean(data && (data.ok === true || data.vkAppId || data.buildSha));
    return { ok: Boolean(res.ok && looksLikeApi), status: res.status, data, url };
  } catch (error) {
    return { ok: false, status: 0, error: error?.name || 'fetch', url };
  } finally {
    clearTimeout(timer);
  }
}

export async function probeHealth(origin, timeoutMs = 4000) {
  const health = await probePath(origin, '/api/health', timeoutMs);
  if (health.ok || health.status === 0) return health;
  return probePath(origin, '/api/config', timeoutMs);
}

export async function startBootProbe() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const hostEl = document.getElementById('boot-host');
  if (hostEl) hostEl.textContent = window.location.host;

  window.__durakBoot?.status?.('Проверяю API...');

  const origin = resolveApiOrigin({
    hostname: window.location.hostname,
    search: window.location.search,
    configured: window.DURAK_API_ORIGIN
  });

  const result = await probeHealth(origin, 4000);
  window.__durakHealth = result;

  const boot = document.getElementById('boot-screen');
  if (!boot || boot.classList.contains('hidden') || boot.classList.contains('error')) return;

  if (!result.ok) {
    const classified = classifyBootFailure({
      hostname: window.location.hostname,
      apiOrigin: origin || window.location.origin,
      htmlLoaded: true,
      healthOk: false
    });
    window.__durakBoot?.fail(classified.message);
    return;
  }

  window.__durakBoot?.status?.('Сервер ответил, вход...');
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  window.DurakBootProbe = {
    classifyBootFailure,
    probeHealth,
    startBootProbe,
    DEFAULT_PAGES_API
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      startBootProbe().catch(() => {});
    });
  } else {
    startBootProbe().catch(() => {});
  }
}
