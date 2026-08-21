/**
 * Same-origin when Express (or a reverse proxy to it) serves the client.
 * Static hosts (Pages, VK hosting) need DURAK_API_ORIGIN / ?api= / Railway fallback.
 */
export const DEFAULT_PAGES_API = 'https://durak-production-3b7a.up.railway.app';

export function isRailwayHost(hostname) {
  return /(^|\.)up\.railway\.app$/i.test(String(hostname || ''));
}

export function hostnameOf(originOrHost) {
  if (!originOrHost) return '';
  try {
    if (/^https?:\/\//i.test(originOrHost)) return new URL(originOrHost).hostname;
  } catch {
    return '';
  }
  return String(originOrHost);
}

export function isStaticHost(hostname) {
  const host = String(hostname || '').toLowerCase();
  if (!host) return false;
  return host.endsWith('github.io')
    || /(^|\.)vk-apps\.com$/.test(host)
    || /(^|\.)vk-apps\.ru$/.test(host)
    || host.endsWith('vkuser.net')
    || host.endsWith('userapi.com')
    || host.endsWith('pages.dev');
}

export function resolveApiOrigin({ hostname, search, configured } = {}) {
  const params = new URLSearchParams(search || '');
  const fromQuery = (params.get('api') || '').trim();
  if (fromQuery) return stripSlash(fromQuery);

  const fromConfig = (configured || '').trim();
  if (fromConfig) return stripSlash(fromConfig);

  const host = hostname || '';
  if (isStaticHost(host)) return DEFAULT_PAGES_API;
  return '';
}

export function needsRemoteApi(hostname) {
  return isStaticHost(hostname);
}

export function apiOrigin() {
  return resolveApiOrigin({
    hostname: window.location.hostname,
    search: window.location.search,
    configured: window.DURAK_API_ORIGIN
  });
}

export function apiUrl(path) {
  const origin = apiOrigin();
  return origin ? `${origin}${path}` : path;
}

export function socketUrl() {
  return apiOrigin() || undefined;
}

function stripSlash(value) {
  return value.replace(/\/$/, '');
}
