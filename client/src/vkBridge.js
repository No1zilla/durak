/**
 * vkBridge.js - VK Bridge for App ID 54720415. Calls VK APIs only inside VK runtime.
 */
/* global vkBridge */

export const VK_APP_ID = 54720415;

const memoryStore = Object.create(null);

export function normalizeLaunchQuery(raw) {
  if (!raw || typeof raw !== 'string') return '';
  let query = raw.trim();
  if (query.startsWith('#') || query.startsWith('?')) query = query.slice(1);
  if (query.startsWith('/?')) query = query.slice(2);
  else if (query.startsWith('/')) query = query.slice(1);
  return query;
}

export function mergeLaunchParams(search, hash) {
  const merged = new URLSearchParams();
  const consume = (raw) => {
    const query = normalizeLaunchQuery(raw);
    if (!query) return;
    for (const [key, value] of new URLSearchParams(query)) {
      merged.set(key, value);
    }
  };
  consume(search);
  consume(hash);
  return merged;
}

export function getLaunchParamsString(search, hash) {
  const loc = typeof window !== 'undefined' ? window.location : { search: '', hash: '' };
  const merged = mergeLaunchParams(search ?? loc.search, hash ?? loc.hash);
  return merged.has('vk_user_id') && merged.has('sign') ? `?${merged.toString()}` : '';
}

export function safeStorageGet(key) {
  try {
    const value = globalThis.localStorage.getItem(key);
    if (value) return value;
  } catch {
    // Chrome blocks Storage in a third-party VK iframe
  }
  try {
    const value = globalThis.sessionStorage.getItem(key);
    if (value) return value;
  } catch {
    // sessionStorage can be blocked the same way
  }
  return memoryStore[key] || null;
}

export function safeStorageSet(key, value) {
  memoryStore[key] = value;
  try {
    globalThis.localStorage.setItem(key, value);
  } catch {
    // ignore
  }
  try {
    globalThis.sessionStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

export function createGuestUser(search, hash) {
  const loc = typeof window !== 'undefined' ? window.location : { search: '', hash: '' };
  const merged = mergeLaunchParams(search ?? loc.search, hash ?? loc.hash);
  const vkUserId = merged.get('vk_user_id');
  if (/^\d+$/.test(vkUserId || '')) {
    return {
      id: `guest_vk_${vkUserId}`,
      rawId: Number(vkUserId),
      name: 'Игрок VK',
      avatar: ''
    };
  }

  const savedName = safeStorageGet('durak_guest_name') || `Игрок_${Math.floor(1000 + Math.random() * 9000)}`;
  const savedId = safeStorageGet('durak_guest_id') || `guest_${Math.random().toString(36).substring(2, 8)}`;
  safeStorageSet('durak_guest_name', savedName);
  safeStorageSet('durak_guest_id', savedId);
  return {
    id: savedId,
    rawId: 0,
    name: savedName,
    avatar: ''
  };
}

function detectVkRuntime() {
  if (typeof vkBridge === 'undefined' || !vkBridge) return false;
  try {
    if (typeof vkBridge.isWebView === 'function' && vkBridge.isWebView()) return true;
    if (typeof vkBridge.isIframe === 'function' && vkBridge.isIframe()) return true;
    if (typeof vkBridge.isEmbedded === 'function' && vkBridge.isEmbedded()) return true;
  } catch {
    // Bridge present but not in VK shell
  }
  return Boolean(getLaunchParamsString());
}

class VKService {
  constructor() {
    this.user = null;
    this.inVK = detectVkRuntime();
  }

  get isVK() {
    return this.inVK;
  }

  getImmediateUser() {
    this.user = createGuestUser();
    return this.user;
  }

  async sendBridge(method, params = {}, timeoutMs = 2500) {
    if (typeof vkBridge === 'undefined' || !vkBridge || typeof vkBridge.send !== 'function') {
      return null;
    }
    try {
      const bridgePromise = vkBridge.send(method, params);
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`VKBridge timeout: ${method}`)), timeoutMs)
      );
      return await Promise.race([bridgePromise, timeoutPromise]);
    } catch (e) {
      console.warn(`VK Bridge [${method}] warning/timeout:`, e.message || e);
      return null;
    }
  }

  async init() {
    this.inVK = detectVkRuntime();
    if (!this.isVK && typeof vkBridge === 'undefined') return;
    const res = await this.sendBridge('VKWebAppInit', {}, 1500);
    if (res) {
      this.inVK = true;
      await this.sendBridge('VKWebAppSetViewSettings', {
        status_bar_style: 'light',
        action_bar_color: '#080605'
      }, 800);
    }
  }

  async getUserInfo() {
    this.inVK = detectVkRuntime() || this.inVK;
    if (this.isVK || typeof vkBridge !== 'undefined') {
      const data = await this.sendBridge('VKWebAppGetUserInfo', {}, 1500);
      if (data && data.id) {
        this.user = {
          id: `vk_${data.id}`,
          rawId: data.id,
          name: `${data.first_name || ''} ${data.last_name || ''}`.trim() || 'Игрок VK',
          avatar: data.photo_200 || data.photo_100 || ''
        };
        return this.user;
      }
    }

    this.user = createGuestUser();
    return this.user;
  }

  taptic(style = 'light') {
    if (this.isVK) {
      try {
        vkBridge.send('VKWebAppTapticImpactOccurred', { style });
      } catch (e) {}
    } else if (navigator.vibrate) {
      navigator.vibrate(style === 'heavy' ? 40 : 15);
    }
  }

  async shareToStory(blobDataUrl) {
    if (this.isVK) {
      const res = await this.sendBridge('VKWebAppShowStoryBox', {
        background_type: 'image',
        blob: blobDataUrl,
        attachment: {
          text: 'open',
          type: 'url',
          url: `https://vk.com/app${VK_APP_ID}`
        }
      }, 5000);
      if (res) return res;
    }
    return { success: false, skipped: true };
  }

  async postToWall(message = 'Победа в Дурак Онлайн 3D!') {
    if (this.isVK) {
      const res = await this.sendBridge('VKWebAppPostToWall', {
        message: `${message}\n\nСыграем? 👉 https://vk.com/app${VK_APP_ID}`
      }, 5000);
      if (res) return res;
    }
    return { success: false, skipped: true };
  }

  async openVKPay(amountRub, description) {
    if (this.isVK) {
      return this.sendBridge('VKWebAppOpenPayForm', {
        app_id: VK_APP_ID,
        action: 'pay-to-service',
        params: {
          amount: amountRub,
          description,
          data: JSON.stringify({ vkId: this.user ? this.user.id : 'unknown', timestamp: Date.now() })
        }
      }, 60000);
    }
    return null;
  }

  async showOrderBox(item) {
    if (!this.isVK) return { ok: false, skipped: true, status: 'unavailable' };
    const res = await this.sendBridge('VKWebAppShowOrderBox', { type: 'item', item }, 120000);
    if (!res) return { ok: false, skipped: false, status: 'fail' };
    const status = res.status || '';
    const ok = status === 'success' || status === 'charged';
    return { ok, status, orderId: res.order_id || null };
  }

  async showRewardedAd() {
    if (!this.isVK) return false;
    const res = await this.sendBridge('VKWebAppShowNativeAds', { ad_format: 'reward' }, 120000);
    return Boolean(res && res.result === true);
  }
}

export const vk = new VKService();
