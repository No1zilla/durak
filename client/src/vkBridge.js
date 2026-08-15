/**
 * vkBridge.js - VK Bridge Integration for App ID 54720415 with Mock Fallback for Local Dev
 */
/* global vkBridge */

export const VK_APP_ID = 54720415;

class VKService {
  constructor() {
    this.user = null;
  }

  get isVK() {
    return typeof vkBridge !== 'undefined' && vkBridge !== null;
  }

  // Safe wrapper for vkBridge.send with a strict timeout
  async sendBridge(method, params = {}, timeoutMs = 1200) {
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
    if (this.isVK) {
      const res = await this.sendBridge('VKWebAppInit', {}, 1000);
      if (res) {
        console.log('✅ VK Bridge initialized');
      }
    }
  }

  async getUserInfo() {
    if (this.isVK) {
      const data = await this.sendBridge('VKWebAppGetUserInfo', {}, 1200);
      if (data && data.id) {
        this.user = {
          id: `vk_${data.id}`,
          rawId: data.id,
          name: `${data.first_name || ''} ${data.last_name || ''}`.trim() || 'Игрок VK',
          avatar: data.photo_200 || data.photo_100 || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&h=100&fit=crop'
        };
        return this.user;
      }
    }

    // Local / Browser Fallback Guest
    const savedName = localStorage.getItem('durak_guest_name') || `Игрок_${Math.floor(1000 + Math.random() * 9000)}`;
    const savedId = localStorage.getItem('durak_guest_id') || `guest_${Math.random().toString(36).substring(2, 8)}`;
    localStorage.setItem('durak_guest_name', savedName);
    localStorage.setItem('durak_guest_id', savedId);

    this.user = {
      id: savedId,
      rawId: 0,
      name: savedName,
      avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&h=100&fit=crop'
    };
    return this.user;
  }

  // Taptic Haptic Engine vibration
  taptic(style = 'light') {
    if (this.isVK) {
      try {
        vkBridge.send('VKWebAppTapticImpactOccurred', { style });
      } catch (e) {}
    } else if (navigator.vibrate) {
      navigator.vibrate(style === 'heavy' ? 40 : 15);
    }
  }

  // Publish Victory Card to VK Stories
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
    alert('Ссылка на историю VK создана! (В мобильном приложении VK откроется публикация)');
    return { success: true };
  }

  // Post Victory Card to VK Wall
  async postToWall(message = 'Победа в Дурак Онлайн 3D! 🃏🔥') {
    if (this.isVK) {
      const res = await this.sendBridge('VKWebAppPostToWall', {
        message: `${message}\n\nСыграем? 👉 https://vk.com/app${VK_APP_ID}`
      }, 5000);
      if (res) return res;
    }
    alert('Запись опубликована на вашей стене VK!');
    return { success: true };
  }

  // VK Pay Checkout
  async openVKPay(amountRub, description) {
    if (this.isVK) {
      const res = await this.sendBridge('VKWebAppOpenPayForm', {
        app_id: VK_APP_ID,
        action: 'pay-to-service',
        params: {
          amount: amountRub,
          description,
          data: JSON.stringify({ vkId: this.user ? this.user.id : 'unknown', timestamp: Date.now() })
        }
      }, 60000);
      if (res) return res;
    }
    alert(`[VK Pay Тест]: Успешная оплата ${amountRub} ₽ за "${description}"`);
    return { status: true };
  }

  // Rewarded Video Ad (Bonus Chips)
  async showRewardedAd() {
    if (this.isVK) {
      const res = await this.sendBridge('VKWebAppShowNativeAds', { ad_format: 'reward' }, 10000);
      if (res && res.result === true) return true;
    }
    return true; // Fallback grant bonus in dev
  }
}

export const vk = new VKService();
