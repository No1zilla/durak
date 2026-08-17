/**
 * vkBridge.js - VK Bridge for App ID 54720415. Calls VK APIs only inside VK runtime.
 */
/* global vkBridge */

export const VK_APP_ID = 54720415;

export function getLaunchParamsString() {
  const merged = new URLSearchParams();
  const consume = (raw) => {
    if (!raw) return;
    const query = raw.startsWith('?') || raw.startsWith('#') ? raw.slice(1) : raw;
    if (!query) return;
    for (const [key, value] of new URLSearchParams(query)) {
      merged.set(key, value);
    }
  };
  consume(window.location.search);
  consume(window.location.hash);
  return merged.has('vk_user_id') && merged.has('sign') ? `?${merged.toString()}` : '';
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
  return !!getLaunchParamsString();
}

class VKService {
  constructor() {
    this.user = null;
    this.inVK = detectVkRuntime();
  }

  get isVK() {
    return this.inVK;
  }

  async sendBridge(method, params = {}, timeoutMs = 2500) {
    if (!this.isVK) return null;
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
    if (!this.isVK) return;
    const res = await this.sendBridge('VKWebAppInit', {}, 2500);
    if (res) {
      await this.sendBridge('VKWebAppSetViewSettings', {
        status_bar_style: 'light',
        action_bar_color: '#080605'
      }, 800);
    }
  }

  async getUserInfo() {
    if (this.isVK) {
      const data = await this.sendBridge('VKWebAppGetUserInfo', {}, 2500);
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

    const savedName = localStorage.getItem('durak_guest_name') || `Игрок_${Math.floor(1000 + Math.random() * 9000)}`;
    const savedId = localStorage.getItem('durak_guest_id') || `guest_${Math.random().toString(36).substring(2, 8)}`;
    localStorage.setItem('durak_guest_name', savedName);
    localStorage.setItem('durak_guest_id', savedId);

    this.user = {
      id: savedId,
      rawId: 0,
      name: savedName,
      avatar: ''
    };
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

  async showRewardedAd() {
    if (this.isVK) {
      const res = await this.sendBridge('VKWebAppShowNativeAds', { ad_format: 'reward' }, 10000);
      if (res && res.result === true) return true;
      return false;
    }
    return false;
  }
}

export const vk = new VKService();
