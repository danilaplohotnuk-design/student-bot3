// index.js — сервер + Telegram бот (локально polling, на хмарі webhook)

import fs from 'fs';
import express from 'express';
import { Telegraf } from 'telegraf';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { getScheduleByDate, schedule } from './schedule.js';
import { getZoomLink } from './zoom-links.js';
import { recordPageVisit, recordHealthPing, getStats } from './stats.js';

dotenv.config();

// Копія початкового розкладу для відновлення
const initialSchedule = JSON.parse(JSON.stringify(schedule));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadVersionInfo() {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'version.json'), 'utf8'));
    const v = String(raw.version || '0.0.0').trim();
    const parts = v.split('.').map((p) => {
      const n = parseInt(p, 10);
      return Number.isFinite(n) ? n : 0;
    });
    while (parts.length < 3) parts.push(0);
    const [a, b, c] = parts;
    const display = `${a}.${String(b).padStart(2, '0')}.${c}`;
    return { version: v, display };
  } catch {
    return { version: '0.0.0', display: '0.00.0' };
  }
}
const VERSION_INFO = loadVersionInfo();

const app = express();
app.set('trust proxy', 1);
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
  // Кнопка "Відкрити розклад" = меню Telegram (setChatMenuButton). Якщо бачиш "17 Розклад" —
  // у BotFather: Bot Settings → Menu Button → встанови "Default", щоб наша кнопка застосовувалась.
  bot.start(async (ctx) => {
    const isPrivate = ctx.chat?.type === 'private';
    const isHttps = WEBAPP_URL.startsWith('https://');
    if (isPrivate && isHttps) {
      try {
        await ctx.telegram.setChatMenuButton({
          chatId: ctx.chat.id,
          menuButton: {
            type: 'web_app',
            text: 'Відкрити розклад',
            web_app: { url: WEBAPP_URL },
          },
        });
        console.log('Кнопка меню встановлена для чату', ctx.chat.id, '→ Відкрити розклад');
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

  // Кнопка меню Telegram (setChatMenuButton з chat_id) працює лише в приватних чатах, не в групах.
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

// Підрахунок відкриття додатку: викликається з main.js після завантаження (надійніше за GET / у Web App)
// Cron до /api/health не виконує JS — у лічильник заходів не потрапляє
app.post('/api/track/pageview', (req, res) => {
  recordPageVisit(req);
  res.status(204).send();
});

// Версія додатку (version.json; GitHub Actions збільшує patch при кожному push)
app.get('/api/version', (req, res) => {
  res.json(VERSION_INFO);
});

// --------- API: розклад ---------

// GET /api/health — для cron-job.org (keep-alive / перевірка доступності)
app.get('/api/health', (req, res) => {
  recordHealthPing();
  res.status(200).json({
    ok: true,
    version: VERSION_INFO.version,
    display: VERSION_INFO.display,
  });
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

/** Проксі до Colormind (HTTP) — з HTTPS-фронту не викликати напряму (mixed content) */
function parseHexToRgb(hex) {
  const m = String(hex ?? '')
    .trim()
    .replace(/^#/, '')
    .match(/^([0-9a-f]{6})$/i);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

app.post('/api/palette/colormind', async (req, res) => {
  const rgb = parseHexToRgb(req.body?.hex);
  if (!rgb) {
    return res.status(400).json({ error: 'Потрібен валідний hex (#RRGGBB)' });
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const cmRes = await fetch('http://colormind.io/api/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'ui',
        input: [[rgb.r, rgb.g, rgb.b], 'N', 'N', 'N', 'N'],
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!cmRes.ok) {
      return res.status(502).json({ error: 'Colormind повернув помилку' });
    }
    const data = await cmRes.json();
    const palette = data?.result;
    if (!Array.isArray(palette) || palette.length !== 5) {
      return res.status(502).json({ error: 'Некоректна відповідь Colormind' });
    }
    res.set('Cache-Control', 'no-store');
    return res.json({ ok: true, palette });
  } catch (err) {
    clearTimeout(timeout);
    return res.status(502).json({ error: 'Colormind недоступний' });
  }
});

// --------- API: адмін-редагування (простий варіант у памʼяті) ---------

// Middleware для простої перевірки пароля
function requireAdmin(req, res, next) {
  const raw = req.headers['x-admin-password'] ?? req.body?.password;
  const password = typeof raw === 'string' ? raw.trim() : raw;
  const expected = String(ADMIN_PASSWORD ?? '').trim();
  if (!password || password !== expected) {
    return res.status(401).json({ error: 'Невірний адмін-пароль' });
  }
  next();
}

// Перевірка пароля (для форми зміни пари в додатку)
app.get('/api/admin/check', requireAdmin, (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ ok: true });
});

/* POST — надійніше в Telegram WebView (пароль у тілі, без кастомного заголовка) */
app.post('/api/admin/check', requireAdmin, (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ ok: true });
});

// Статистика відвідувань (заходи на головну; окремо — ping cron до /api/health)
app.get('/api/admin/stats', requireAdmin, (req, res) => {
  res.json(getStats());
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
        allowed_updates: ['message'],
      });
      console.log('Telegram webhook встановлено:', BASE_URL + '/webhook');
    } catch (err) {
      console.error('Помилка встановлення webhook:', err.message || err);
    }
  } else {
    bot.launch({
      allowedUpdates: ['message'],
    }).then(() => console.log('Telegram бот (polling) запущений'))
      .catch((err) => console.error('Помилка запуску бота:', err.message || err));
  }
  if (RUN_BOT && WEBAPP_URL.startsWith('https://')) {
    try {
      await bot.telegram.setChatMenuButton({
        menuButton: {
          type: 'web_app',
          text: 'Відкрити розклад',
          web_app: { url: WEBAPP_URL },
        },
      });
      console.log('Кнопка меню Telegram встановлена (за замовчуванням для нових користувачів)');
    } catch (err) {
      console.error('Помилка встановлення кнопки меню:', err.message || err);
    }
  }
  if (RUN_BOT && !USE_WEBHOOK) console.log('Локально: http://localhost:' + PORT);
});