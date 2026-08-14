/**
 * vkBridge.js - VK Bridge Integration for App ID 54720415 with Mock Fallback for Local Dev
 */
/* global vkBridge */

export const VK_APP_ID = 54720415;

class VKService {
  constructor() {
    this.isVK = typeof vkBridge !== 'undefined' && vkBridge !== null;
    this.user = null;
  }

  async init() {
    if (this.isVK) {
      try {
        await vkBridge.send('VKWebAppInit');
        console.log('✅ VK Bridge initialized');
      } catch (e) {
        console.warn('VK Bridge init warning:', e);
      }
    }
  }

  async getUserInfo() {
    if (this.isVK) {
      try {
        const data = await vkBridge.send('VKWebAppGetUserInfo');
        this.user = {
          id: `vk_${data.id}`,
          rawId: data.id,
          name: `${data.first_name} ${data.last_name}`.trim(),
          avatar: data.photo_200 || data.photo_100 || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&h=100&fit=crop'
        };
        return this.user;
      } catch (e) {
        console.warn('VK GetUserInfo fallback:', e);
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
      try {
        return await vkBridge.send('VKWebAppShowStoryBox', {
          background_type: 'image',
          blob: blobDataUrl,
          attachment: {
            text: 'open',
            type: 'url',
            url: `https://vk.com/app${VK_APP_ID}`
          }
        });
      } catch (e) {
        console.error('VK Story Share error:', e);
      }
    }
    alert('Ссылка на историю VK создана! (В мобильном приложении VK откроется публикация)');
    return { success: true };
  }

  // Post Victory Card to VK Wall
  async postToWall(message = 'Победа в Дурак Онлайн 3D! 🃏🔥') {
    if (this.isVK) {
      try {
        return await vkBridge.send('VKWebAppPostToWall', {
          message: `${message}\n\nСыграем? 👉 https://vk.com/app${VK_APP_ID}`
        });
      } catch (e) {
        console.error('VK Wall Post error:', e);
      }
    }
    alert('Запись опубликована на вашей стене VK!');
    return { success: true };
  }

  // VK Pay Checkout
  async openVKPay(amountRub, description) {
    if (this.isVK) {
      try {
        return await vkBridge.send('VKWebAppOpenPayForm', {
          app_id: VK_APP_ID,
          action: 'pay-to-service',
          params: {
            amount: amountRub,
            description,
            data: JSON.stringify({ vkId: this.user ? this.user.id : 'unknown', timestamp: Date.now() })
          }
        });
      } catch (e) {
        console.error('VK Pay error:', e);
      }
    }
    alert(`[VK Pay Тест]: Успешная оплата ${amountRub} ₽ за "${description}"`);
    return { status: true };
  }

  // Rewarded Video Ad (Bonus Chips)
  async showRewardedAd() {
    if (this.isVK) {
      try {
        const res = await vkBridge.send('VKWebAppShowNativeAds', { ad_format: 'reward' });
        return res.result === true;
      } catch (e) {
        console.warn('VK Ad error / not available:', e);
      }
    }
    return true; // Fallback grant bonus in dev
  }
}

export const vk = new VKService();
