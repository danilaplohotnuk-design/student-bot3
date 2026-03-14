// index.js — сервер + Telegram бот (локально polling, на хмарі webhook)

import express from 'express';
import { Telegraf, Markup } from 'telegraf';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { getScheduleByDate, schedule } from './schedule.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// На хмарі (Render тощо) використовуємо RENDER_EXTERNAL_URL
const BASE_URL = process.env.RENDER_EXTERNAL_URL || process.env.WEBAPP_URL || `http://localhost:${PORT}`;
const WEBAPP_URL = process.env.WEBAPP_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'change-me';
const BOT_TOKEN = process.env.BOT_TOKEN;

if (!BOT_TOKEN) {
  console.error('BOT_TOKEN не заданий. Додай у .env або в змінні середовища хостингу.');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);
const USE_WEBHOOK = BASE_URL.startsWith('https://');

// Команда /start
bot.start(async (ctx) => {
  const text = 'Привіт! Це розклад занять. Натисни кнопку, щоб відкрити веб-додаток.';
  const isHttps = WEBAPP_URL.startsWith('https://');
  try {
    if (isHttps) {
      await ctx.reply(text, Markup.inlineKeyboard([
        Markup.button.webApp('Відкрити розклад', WEBAPP_URL)
      ]));
    } else {
      await ctx.reply(text + '\n\n(Кнопка зʼявиться після деплою на HTTPS.)');
    }
  } catch (err) {
    console.error('Помилка відправки повідомлення бота:', err.message || err);
    try { await ctx.reply(text); } catch (_) {}
  }
});

// Webhook для хмарного хостингу (обробляти до express.json())
if (USE_WEBHOOK) {
  app.use(bot.webhookCallback('/webhook'));
}

// Коректне завершення (лише для polling)
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

// --------- Express: фронтенд і API ---------
app.use(express.json());

// Віддавати статичні файли з папки web (вона в тому ж корені, що й index.js)
app.use(express.static(path.join(__dirname, 'web')));

// --------- API: розклад ---------

// GET /api/schedule?date=YYYY-MM-DD  – розклад на конкретну дату
app.get('/api/schedule', (req, res) => {
  const { date } = req.query;

  if (!date) {
    return res.status(400).json({ error: 'Потрібен параметр date=YYYY-MM-DD' });
  }

  const lessons = getScheduleByDate(date);
  res.json({ date, lessons });
});

// (простий) GET /api/schedule/all – увесь розклад (на майбутнє)
app.get('/api/schedule/all', (req, res) => {
  res.json({ total: schedule.length, lessons: schedule });
});

// --------- API: адмін-редагування (простий варіант у памʼяті) ---------

// Middleware для простої перевірки пароля
function requireAdmin(req, res, next) {
  const password = req.headers['x-admin-password'] || req.body?.password;
  if (!password || password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Невірний адмін-пароль' });
  }
  next();
}

// Додати пару
app.post('/api/admin/schedule/add', requireAdmin, (req, res) => {
  const { date, startTime, endTime, title, teacher, building, room } = req.body;

  if (!date || !startTime || !endTime || !title || !building || !room) {
    return res.status(400).json({ error: 'Необхідні поля: date, startTime, endTime, title, building, room' });
  }

  const newLesson = { date, startTime, endTime, title, teacher: teacher || null, building, room };
  schedule.push(newLesson);
  res.json({ ok: true, lesson: newLesson });
});

// Видалити пари по точній відповідності
app.post('/api/admin/schedule/delete', requireAdmin, (req, res) => {
  const { date, startTime, title } = req.body;

  if (!date || !startTime || !title) {
    return res.status(400).json({ error: 'Необхідні поля: date, startTime, title' });
  }

  const before = schedule.length;
  for (let i = schedule.length - 1; i >= 0; i--) {
    if (
      schedule[i].date === date &&
      schedule[i].startTime === startTime &&
      schedule[i].title === title
    ) {
      schedule.splice(i, 1);
    }
  }
  const removed = before - schedule.length;
  res.json({ ok: true, removed });
});

// --------- Старт сервера ---------
app.listen(PORT, async () => {
  console.log(`Web-сервер на порту ${PORT}`);
  if (USE_WEBHOOK) {
    try {
      await bot.telegram.setWebhook(`${BASE_URL}/webhook`);
      console.log('Telegram webhook встановлено:', BASE_URL + '/webhook');
    } catch (err) {
      console.error('Помилка встановлення webhook:', err.message || err);
    }
  } else {
    bot.launch().then(() => console.log('Telegram бот (polling) запущений'))
      .catch((err) => console.error('Помилка запуску бота:', err.message || err));
  }
  if (!USE_WEBHOOK) console.log('Локально: http://localhost:' + PORT);
});