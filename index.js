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

const REMINDER_FILE = path.join(__dirname, 'reminder.json');
const BIRTHDAYS_FILE = path.join(__dirname, 'web', 'birthdays.json');

function validateBirthdayRecord(e) {
  if (!e || typeof e !== 'object') return null;
  const m = parseInt(String(e.month), 10);
  const d = parseInt(String(e.day), 10);
  const name = typeof e.name === 'string' ? e.name.trim() : '';
  if (!Number.isFinite(m) || !Number.isFinite(d)) return null;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  if (!name || name.length > 200) return null;
  return { month: m, day: d, name };
}

function readBirthdaysFromDisk() {
  try {
    const raw = fs.readFileSync(BIRTHDAYS_FILE, 'utf8');
    const j = JSON.parse(raw);
    const arr = Array.isArray(j.birthdays) ? j.birthdays : [];
    return arr.map(validateBirthdayRecord).filter(Boolean);
  } catch {
    return [];
  }
}

function writeBirthdaysToDisk(birthdays) {
  const sorted = [...birthdays].sort(
    (a, b) => a.month - b.month || a.day - b.day || a.name.localeCompare(b.name, 'uk'),
  );
  fs.mkdirSync(path.dirname(BIRTHDAYS_FILE), { recursive: true });
  fs.writeFileSync(BIRTHDAYS_FILE, `${JSON.stringify({ birthdays: sorted }, null, 2)}\n`, 'utf8');
  return sorted;
}

/** { text, updatedAt, history[] } — history = попередні версії (тільки для адмінки) */
function readReminderFromDisk() {
  try {
    const raw = fs.readFileSync(REMINDER_FILE, 'utf8');
    const j = JSON.parse(raw);
    const text = typeof j.text === 'string' ? j.text : '';
    let updatedAt = Number(j.updatedAt);
    if (text && (!Number.isFinite(updatedAt) || updatedAt <= 0)) {
      updatedAt = Date.now();
      const hist = Array.isArray(j.history) ? j.history : [];
      fs.writeFileSync(REMINDER_FILE, JSON.stringify({ text, updatedAt, history: hist }), 'utf8');
    }
    if (!Number.isFinite(updatedAt)) updatedAt = 0;
    let history = [];
    if (Array.isArray(j.history)) {
      history = j.history
        .filter((h) => h && typeof h.text === 'string' && Number.isFinite(Number(h.updatedAt)))
        .map((h) => ({ text: h.text, updatedAt: Number(h.updatedAt) }));
    }
    return { text, updatedAt, history };
  } catch {
    return { text: '', updatedAt: 0, history: [] };
  }
}

function writeReminderToDisk(text) {
  const prev = readReminderFromDisk();
  const history = Array.isArray(prev.history) ? [...prev.history] : [];
  const newText = String(text ?? '');
  if (prev.text && prev.text.trim() && prev.text !== newText && prev.updatedAt > 0) {
    history.unshift({ text: prev.text, updatedAt: prev.updatedAt });
  }
  while (history.length > 50) history.pop();
  const updatedAt = Date.now();
  const payload = { text: newText, updatedAt, history };
  fs.writeFileSync(REMINDER_FILE, JSON.stringify(payload), 'utf8');
  return payload;
}

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

/** Публічне нагадування видно студентам лише 24 год з моменту збереження (якщо не з’явилось нове) */
const REMINDER_PUBLIC_TTL_MS = 24 * 60 * 60 * 1000;

// Текст нагадування + історія версій (для всіх; текст приховується після 24 год, історія лишається)
app.get('/api/reminder', (req, res) => {
  res.set('Cache-Control', 'no-store');
  const r = readReminderFromDisk();
  const text = typeof r.text === 'string' ? r.text : '';
  const ts = Number(r.updatedAt);
  const history = Array.isArray(r.history) ? r.history : [];
  const hasText = text.trim().length > 0;
  if (!hasText || !Number.isFinite(ts) || ts <= 0) {
    return res.json({ text: '', updatedAt: Number.isFinite(ts) ? ts : 0, history });
  }
  if (Date.now() - ts > REMINDER_PUBLIC_TTL_MS) {
    return res.json({ text: '', updatedAt: ts, history });
  }
  res.json({ text, updatedAt: ts, history });
});

// Повне нагадування + історія (лише адмін)
app.get('/api/admin/reminder', requireAdmin, (req, res) => {
  res.set('Cache-Control', 'no-store');
  const r = readReminderFromDisk();
  res.json({
    text: r.text,
    updatedAt: r.updatedAt,
    history: Array.isArray(r.history) ? r.history : [],
  });
});

// Дні народження (читається з web/birthdays.json)
app.get('/api/birthdays', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ birthdays: readBirthdaysFromDisk() });
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

// Текст нагадування (адмін)
app.put('/api/admin/reminder', requireAdmin, (req, res) => {
  const raw = req.body?.text;
  if (typeof raw !== 'string') {
    return res.status(400).json({ error: 'Потрібне поле text (рядок)' });
  }
  if (raw.length > 4000) {
    return res.status(400).json({ error: 'Текст не довший за 4000 символів' });
  }
  const payload = writeReminderToDisk(raw);
  res.set('Cache-Control', 'no-store');
  res.json({ ok: true, ...payload });
});

// Дні народження: повна заміна списку (додавання / видалення з клієнта)
app.put('/api/admin/birthdays', requireAdmin, (req, res) => {
  const raw = req.body?.birthdays;
  if (!Array.isArray(raw)) {
    return res.status(400).json({ error: 'Потрібне поле birthdays (масив)' });
  }
  if (raw.length > 400) {
    return res.status(400).json({ error: 'Занадто багато записів' });
  }
  const validated = [];
  for (let i = 0; i < raw.length; i++) {
    const v = validateBirthdayRecord(raw[i]);
    if (!v) {
      return res.status(400).json({ error: `Некоректний запис #${i + 1}` });
    }
    validated.push(v);
  }
  const saved = writeBirthdaysToDisk(validated);
  res.set('Cache-Control', 'no-store');
  res.json({ ok: true, birthdays: saved });
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