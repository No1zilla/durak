# 🃏 Дурак Онлайн 3D

> **VK App ID**: `54720415`  
> **Игра крутится на Railway. В кабинет VK из РФ Railway ставить нельзя.**

---

## VK из России: какой URL в кабинете

Приложение **не открывается из VK в РФ**, если iframe указывает на
`https://durak-production-3b7a.up.railway.app/` — это `69.46.46.92` (Railway Hikari, edge `lax1`).
С чек-ноды **ru1 Москва** TCP/443 туда **timeout**. С тех же нод **Cloudflare открывается**.
`github.io` как iframe VK тоже не подходит: WebView не держит чужой Socket.IO, GitHub в РФ нестабилен.

**В кабинете VK (Web / iOS&Android / m.vk) должен стоять URL Cloudflare-прокси, не Railway и не Pages.**
Кабинет агент не меняет — URL вставляете вы.

### 1) Прокси (обязательно, аккаунт Cloudflare бесплатный)

Railway не трогаем: прокси ходит к нему уже из сети Cloudflare, не из РФ.

```bash
npx wrangler@4 login
npm run deploy:cf
```

В выводе будет `https://durak-vk-proxy.<аккаунт>.workers.dev`.
Его же поставьте:

1. [vk.com/apps?act=manage](https://vk.com/apps?act=manage) → приложение **54720415**
2. Размещение → URL **Web**, **Мобильное приложение**, **Мобильная версия сайта**
3. Все три: `https://durak-vk-proxy.<аккаунт>.workers.dev/` (со слэшем или без — неважно)

Проверка с телефона без VPN: `https://vk.com/app54720415`.
Сплэш должен показать хост `*.workers.dev` и скрыться. Если видите `up.railway.app` — кабинет ещё на старом URL.

Свой домен (reg.ru / Timeweb / nic.ru):

1. Домен в Cloudflare (оранжевое облако).
2. Workers → durak-vk-proxy → Custom Domain, например `https://durak.ваш.домен/`.
3. **Этот** URL — в кабинет VK.
4. На Railway (опционально) `PUBLIC_ORIGIN=https://durak.ваш.домен`.

CNAME напрямую на `*.up.railway.app` без Cloudflare **не лечит РФ**: клиент снова попадёт на `69.46.46.x`.
Кастомный домен в Railway без оранжевого Cloudflare — то же самое.

### 2) Хостинг VK (только статика, не замена прокси)

`npm run deploy:vk` заливает `client/` на CDN VK (из WebView РФ HTML откроется всегда).
Сокеты всё равно нужны на **том же origin, что iframe**, иначе VK WebView режет API.
Поэтому iframe в кабинете — всё равно Cloudflare, а не URL vk-miniapps-deploy.

Если всё же льёте статику отдельно:

```bash
DURAK_API_ORIGIN=https://durak-vk-proxy.<аккаунт>.workers.dev npm run write-runtime-config
npm run deploy:vk
```

`DURAK_API_ORIGIN` = прокси, **не** `*.up.railway.app`.

---

## 🌟 Что реализовано

- Режимы: подкидной и переводной, 2–6 игроков, колоды 24/36/52.
- Сервер не отдаёт чужие карты. Боты для быстрого старта.
- Three.js стол, веер карт, броски предметов, VK Bridge / Stories / VK Pay-хуки.
- Звук на Web Audio без тяжёлых mp3.

## Локально

```bash
npm start
```

Сервер: фронт и API на `http://localhost:3000`.

## Railway

Игра уже на `https://durak-production-3b7a.up.railway.app/` (автодеплой `main`).
Этот URL **не** ставить в кабинет VK для аудитории в РФ. Прокси — раздел выше.
