/** Map a browser request URL onto the Railway origin (path + query kept). */
export function outboundUrl(requestUrl, origin) {
  const incoming = new URL(requestUrl);
  return String(origin).replace(/\/$/, '') + incoming.pathname + incoming.search;
}

export const DEFAULT_RAILWAY_ORIGIN = 'https://durak-production-3b7a.up.railway.app';
