# Розклад (tg-schedule-app)

## Локальний запуск

Після `npm install`:

```bash
npm run dev
# або
npm start
```

**Відкрий у браузері:** [http://localhost:3000](http://localhost:3000)

Порт задається змінною `PORT` у `.env` (за замовчуванням **3000** у `index.js`).

### Telegram WebApp

Щоб бот відкривав саме локальний додаток, у `.env` вкажи `WEBAPP_URL=http://localhost:3000` (і тунель на кшталт ngrok, якщо Telegram не може достукатися до `localhost`).

Копію змінних з прикладу: `.env.example`

## Supabase («Важливо»)

У продакшні зручно тримати текст «Важливо» в **Supabase** (таблиця з `supabase/reminder.sql`): додай у середовище **`SUPABASE_URL`** і **`SUPABASE_SERVICE_ROLE_KEY`** (розділ API → **service_role**, не anon). Без цих змінних використовується файл **`reminder.json`** (тоді варто задати **`DATA_DIR`** на постійному диску на Render).

## Статистика відвідувань (після деплою)

Лічильники зберігаються у **`stats.json`** (шлях: `STATS_FILE` або `DATA_DIR/stats.json`, інакше файл у корені проєкту).

На **Render** без Persistent Disk файли зникають при кожному деплої — щоб статистика не обнулялась, змонтуй диск і вкажи той самий **`DATA_DIR`**, що й для `reminder.json` (див. `.env.example`).
