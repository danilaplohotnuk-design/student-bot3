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
