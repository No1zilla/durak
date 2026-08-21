const crypto = require('crypto');
const { VKPAY_SKUS } = require('./services/economyService');

const VK_APP_ID = process.env.VK_APP_ID || '54720415';

function paymentsSecret(env = process.env) {
  return String(env.VK_PAYMENTS_SECRET || env.VK_CLIENT_SECRET || '');
}

function paymentsReady(env = process.env) {
  return Boolean(paymentsSecret(env));
}

function flattenBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return {};
  const out = {};
  for (const [key, value] of Object.entries(body)) {
    if (Array.isArray(value)) out[key] = value.length ? String(value[value.length - 1]) : '';
    else if (value == null) out[key] = '';
    else if (typeof value === 'object') continue;
    else out[key] = String(value);
  }
  return out;
}

function signVkPaymentParams(params, secret) {
  const keys = Object.keys(params).filter((key) => key !== 'sig').sort();
  const concat = keys.map((key) => `${key}=${params[key] == null ? '' : String(params[key])}`).join('');
  return crypto.createHash('md5').update(concat + secret, 'utf8').digest('hex');
}

function verifyVkPaymentSignature(params, secret) {
  if (!secret) return false;
  const sig = String(params.sig || '').toLowerCase();
  const expected = signVkPaymentParams(params, secret);
  if (!sig || sig.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
}

function vkError(code, message) {
  return {
    http: 200,
    json: { error: { error_code: code, error_msg: message, critical: true } }
  };
}

function notificationKind(type) {
  const value = String(type || '');
  if (value === 'get_item' || value === 'get_item_test') return 'get_item';
  if (value === 'order_status_change' || value === 'order_status_change_test') return 'order_status_change';
  return value;
}

function skuFromItem(item) {
  const id = String(item || '').split(',')[0].trim();
  return VKPAY_SKUS[id] || null;
}

function processVkNotification(rawBody, economy, options = {}) {
  const params = flattenBody(rawBody);
  const secret = options.secret ?? paymentsSecret();
  const appId = String(options.appId || VK_APP_ID);

  if (!secret) {
    return vkError(1, 'VK_CLIENT_SECRET не задан на Railway — оплата не настроена');
  }
  if (!verifyVkPaymentSignature(params, secret)) {
    return vkError(10, 'Неверная подпись');
  }
  if (String(params.app_id) !== appId) {
    return vkError(11, 'Неверный app_id');
  }

  const kind = notificationKind(params.notification_type);
  const test = String(params.notification_type || '').endsWith('_test');

  if (kind === 'get_item') {
    const sku = skuFromItem(params.item);
    if (!sku) return vkError(20, 'Товара не существует');
    const response = {
      title: sku.name.slice(0, 48),
      price: sku.priceVotes,
      item_id: sku.id,
      expiration: 3600
    };
    if (options.photoUrl) response.photo_url = options.photoUrl;
    return { http: 200, json: { response } };
  }

  if (kind === 'order_status_change') {
    const sku = skuFromItem(params.item);
    if (!sku) return vkError(20, 'Товара не существует');
    if (params.item_price && Number(params.item_price) !== sku.priceVotes) {
      return vkError(11, 'Цена товара не совпадает с каталогом');
    }
    const userId = String(params.user_id || '');
    const orderId = String(params.order_id || '');
    if (!/^\d+$/.test(userId) || !orderId) {
      return vkError(11, 'Нет user_id или order_id');
    }

    if (params.status === 'refunded') {
      const refunded = economy.refundVkOrder({ userId, orderId, test });
      return {
        http: 200,
        json: { response: { order_id: Number(orderId), app_order_id: refunded.appOrderId } },
        userId: `vk_${userId}`
      };
    }
    if (params.status !== 'chargeable') {
      return vkError(11, 'Неизвестный статус заказа');
    }

    const result = economy.fulfillVkOrder({ userId, orderId, skuId: sku.id, test });
    if (!result.success) {
      return vkError(21, result.error || 'Не удалось выдать товар');
    }
    return {
      http: 200,
      json: { response: { order_id: Number(orderId), app_order_id: result.appOrderId } },
      userId: `vk_${userId}`,
      fulfilled: result
    };
  }

  return vkError(11, 'Неизвестный notification_type');
}

function publicPaymentsInfo(env = process.env) {
  const ready = paymentsReady(env);
  return {
    votesEnabled: ready,
    adsEnabled: true,
    webhookPath: '/api/vkpay/notification',
    currency: 'votes',
    voteRub: 7,
    configured: ready,
    hint: ready
      ? null
      : 'Оплата не настроена: задайте VK_CLIENT_SECRET на Railway и URL уведомлений в кабинете VK'
  };
}

module.exports = {
  paymentsSecret,
  paymentsReady,
  flattenBody,
  signVkPaymentParams,
  verifyVkPaymentSignature,
  processVkNotification,
  publicPaymentsInfo,
  skuFromItem
};
