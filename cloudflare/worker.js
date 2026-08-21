/**
 * Reverse-proxy Railway so VK in Russia hits Cloudflare anycast, not 69.46.46.x.
 * WebSockets: pass the original Request through fetch().
 */
import { DEFAULT_RAILWAY_ORIGIN, outboundUrl } from './origin.js';

export default {
  async fetch(request, env) {
    const origin = String(env.RAILWAY_ORIGIN || DEFAULT_RAILWAY_ORIGIN).replace(/\/$/, '');
    const target = outboundUrl(request.url, origin);
    const outbound = new Request(target, request);
    outbound.headers.set('X-Forwarded-Host', new URL(request.url).host);
    outbound.headers.set('X-Forwarded-Proto', 'https');
    outbound.headers.set('X-Durak-Proxy', 'cloudflare');
    return fetch(outbound);
  }
};
