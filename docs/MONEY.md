# Деньги: реклама и голоса VK

App ID `54720415`. Секреты в репозиторий не кладём.

## Реклама (уже в коде, без мерчанта)

Кабинет: [приложения](https://vk.com/apps?act=manage) → **54720415** → монетизация / реклама → включить **native ads**, формат **reward**.

В игре: Награды → «Реклама за 400 фишек». Сервер начисляет только после `result: true` от моста, кап 3/день, кулдаун 8 с, запись в JSON.

## Оплата голосами (нужен секрет)

Это не Stripe и не ЮKassa. Клиент открывает `VKWebAppShowOrderBox`, VK бьёт webhook, **сервер** выдаёт фишки.

1. Railway → Variables: `VK_CLIENT_SECRET` = защищённый ключ приложения (Настройки → ключи). Тот же ключ, что подпись launch params.
2. Кабинет → **Платежи**:
   - версия API **5.132**;
   - адрес уведомлений: `https://<Cloudflare-origin>/api/vkpay/notification`  
     (если прокси ещё нет — временно `https://durak-production-3b7a.up.railway.app/api/vkpay/notification`; VK-серверы ходят сюда сами, не игрок из РФ);
   - тестовые платежи + testers, пока приложение не прошло проверку платежей.
3. Не github.io. Не сырой Railway в **iframe** кабинета (РФ). Webhook и iframe — разные URL-роли.

Без секрета webhook отвечает `{ error_code: 1, error_msg: "VK_CLIENT_SECRET не задан..." }`, в магазине кнопки «Оплата не настроена». Клиент фишки сам не плюсует.

Проверка: `GET /api/health` → `paymentsReady: true`. `GET /api/vkpay/notification` показывает, настроен ли секрет.
