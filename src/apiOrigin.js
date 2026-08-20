/**
 * Front on GitHub Pages, API on Railway (or same origin when Express serves the client).
 */
export function resolveApiOrigin({ hostname, search, configured } = {}) {
  const params = new URLSearchParams(search || '');
  const fromQuery = (params.get('api') || '').trim();
  if (fromQuery) return stripSlash(fromQuery);

  const fromConfig = (configured || '').trim();
  if (fromConfig) return stripSlash(fromConfig);

  const host = hostname || '';
  if (host.endsWith('github.io')) return '';
  return '';
}

export function needsRemoteApi(hostname) {
  return String(hostname || '').endsWith('github.io');
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
