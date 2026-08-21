# Volume для кошелька на Railway

JSON-экономика (`users`, ledger, заказы) живёт в одном файле. Без volume **каждый деплой `main` обнуляет фишки, рекламу и оплаты**.

Postgres в репозитории нет — не подключаем.

В Dockerfile **нет** `VOLUME`: на Railway том задаётся в UI, иначе деплой может сразу упасть.

## Что сделать в Railway

1. Сервис `durak` → **Volumes** → Add volume.
2. **Mount path:** `/data`
3. `ECONOMY_FILE` можно не задавать: если каталог `/data` есть, сервер пишет `/data/state.json`. Иначе можно явно: `ECONOMY_FILE=/data/state.json`.

Проверка после деплоя: `/api/metrics` не сбрасывается в `users: 0` после следующего пуша в `main`.
