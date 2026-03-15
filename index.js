// index.js — сервер + Telegram бот (локально polling, на хмарі webhook)

import express from 'express';
import { Telegraf } from 'telegraf';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { getScheduleByDate, schedule } from './schedule.js';
import { getZoomLink } from './zoom-links.js';

dotenv.config();

// Копія початкового розкладу для відновлення
const initialSchedule = JSON.parse(JSON.stringify(schedule));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// На хмарі (Render тощо) використовуємо RENDER_EXTERNAL_URL
const BASE_URL = process.env.RENDER_EXTERNAL_URL || process.env.WEBAPP_URL || `http://localhost:${PORT}`;
const WEBAPP_URL = process.env.WEBAPP_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'change-me';
const BOT_TOKEN = process.env.BOT_TOKEN;
const RUN_BOT = Boolean(BOT_TOKEN);

let bot = null;
if (RUN_BOT) {
  bot = new Telegraf(BOT_TOKEN);
  // Команда /start — тільки текст; кнопка біля поля вводу = меню Telegram (синя, як "Open"), не інлайн
  bot.start(async (ctx) => {
    const isPrivate = ctx.chat?.type === 'private';
    const isHttps = WEBAPP_URL.startsWith('https://');
    if (isPrivate && isHttps) {
      try {
        await ctx.telegram.setChatMenuButton(ctx.chat.id, {
          type: 'web_app',
          text: 'Відкрити розклад',
          web_app: { url: WEBAPP_URL },
        });
      } catch (err) {
        console.error('Помилка встановлення кнопки меню:', err.message || err);
      }
    }
    const text = isHttps
      ? 'Привіт! Це розклад занять. Натисни синю кнопку біля поля вводу, щоб відкрити веб-додаток.'
      : 'Привіт! Це розклад занять. Кнопка зʼявиться після деплою на HTTPS.';
    try {
      await ctx.reply(text);
    } catch (err) {
      console.error('Помилка відправки повідомлення бота:', err.message || err);
      try { await ctx.reply(text); } catch (_) {}
    }
  });

  // Коли бота додають в групу — встановити кнопку меню Telegram «Відкрити розклад»
  bot.on('my_chat_member', async (ctx) => {
    const update = ctx.myChatMember;
    if (!update) return;
    const newStatus = update.new_chat_member?.status;
    const oldStatus = update.old_chat_member?.status;
    const isAdded = (newStatus === 'member' || newStatus === 'administrator') &&
      (oldStatus === 'left' || oldStatus === 'kicked' || oldStatus === undefined);
    if (!isAdded) return;
    const chatId = update.chat.id;
    const isGroup = update.chat.type === 'group' || update.chat.type === 'supergroup';
    if (!isGroup || !WEBAPP_URL.startsWith('https://')) return;
    const botId = ctx.botInfo?.id;
    const addedUserId = update.new_chat_member?.user?.id;
    if (botId != null && addedUserId !== botId) return;
    try {
      await ctx.telegram.setChatMenuButton(chatId, {
        type: 'web_app',
        text: 'Відкрити розклад',
        web_app: { url: WEBAPP_URL },
      });
    } catch (err) {
      console.error('Помилка встановлення кнопки меню в групі:', err.message || err);
    }
  });
}

const USE_WEBHOOK = RUN_BOT && BASE_URL.startsWith('https://');
if (RUN_BOT && USE_WEBHOOK) {
  app.use(bot.webhookCallback('/webhook'));
}
if (RUN_BOT) {
  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

// --------- Express: фронтенд і API ---------
app.use(express.json());

// Віддавати статичні файли з папки web (вона в тому ж корені, що й index.js)
app.use(express.static(path.join(__dirname, 'web')));

// --------- API: розклад ---------

// GET /api/health — для cron-job.org (keep-alive / перевірка доступності)
app.get('/api/health', (req, res) => {
  res.status(200).json({ ok: true });
});

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

// GET /api/schedule/subjects – унікальні назви предметів (для форми зміни пари)
app.get('/api/schedule/subjects', (req, res) => {
  const titles = [...new Set(schedule.map((l) => l.title))].sort();
  res.json({ subjects: titles });
});

// GET /api/zoom-link?title=...&teacher=... – посилання Zoom для предмету
app.get('/api/zoom-link', (req, res) => {
  const title = req.query.title || '';
  const teacher = req.query.teacher || '';
  const url = getZoomLink(title, teacher);
  res.json({ url: url || null });
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

// Перевірка пароля (для форми зміни пари в додатку)
app.get('/api/admin/check', requireAdmin, (req, res) => {
  res.json({ ok: true });
});

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

// Відновити весь розклад до початкового стану
app.post('/api/admin/schedule/restore', requireAdmin, (req, res) => {
  schedule.length = 0;
  schedule.push(...JSON.parse(JSON.stringify(initialSchedule)));
  res.json({ ok: true });
});

// --------- Старт сервера ---------
app.listen(PORT, async () => {
  console.log(`Web-сервер на порту ${PORT}`);
  if (!RUN_BOT) {
    console.log('Бот не запущено (BOT_TOKEN не заданий). Тільки веб-додаток і API. Бот окремо в student-bot-telegram.');
  } else if (USE_WEBHOOK) {
    try {
      await bot.telegram.setWebhook(`${BASE_URL}/webhook`, {
        allowed_updates: ['message', 'my_chat_member'],
      });
      console.log('Telegram webhook встановлено:', BASE_URL + '/webhook');
    } catch (err) {
      console.error('Помилка встановлення webhook:', err.message || err);
    }
  } else {
    bot.launch({
      allowedUpdates: ['message', 'my_chat_member'],
    }).then(() => console.log('Telegram бот (polling) запущений'))
      .catch((err) => console.error('Помилка запуску бота:', err.message || err));
  }
  if (RUN_BOT && WEBAPP_URL.startsWith('https://')) {
    try {
      await bot.telegram.setChatMenuButton({
        type: 'web_app',
        text: 'Відкрити розклад',
        web_app: { url: WEBAPP_URL },
      });
      console.log('Кнопка меню Telegram встановлена (приватний чат)');
    } catch (err) {
      console.error('Помилка встановлення кнопки меню:', err.message || err);
    }
  }
  if (RUN_BOT && !USE_WEBHOOK) console.log('Локально: http://localhost:' + PORT);
});