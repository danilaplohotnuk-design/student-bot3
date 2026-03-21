# Деплой на хмару (Render.com)

Після деплою додаток працюватиме по посиланню, нічого не треба запускати на комп'ютері. Бот у Telegram відкриватиме розклад по кнопці.

---

## 1. Репозиторій на GitHub

1. Зареєструйся на [github.com](https://github.com) (якщо ще немає).
2. Створи **новий репозиторій** (New repository):
   - назва, наприклад: `tg-schedule-app`;
   - Public;
   - **не** стави галочку "Add a README" (проєкт уже є локально).
3. У PowerShell у папці проєкту виконай:

```powershell
cd "C:\Users\danil\Desktop\tg-schedule-app"
git init
git add .
git commit -m "Initial: розклад + бот + адмін"
git branch -M main
git remote add origin https://github.com/ТВІЙ_ЛОГІН/tg-schedule-app.git
git push -u origin main
```

(Замість `ТВІЙ_ЛОГІН` — твій нік на GitHub. Якщо Git питає логін/пароль — використовуй **Personal Access Token** замість пароля: GitHub → Settings → Developer settings → Personal access tokens.)

---

## 2. Хостинг Render.com

1. Зайди на [render.com](https://render.com), зареєструйся (можна через GitHub).
2. **Dashboard** → **New** → **Web Service**.
3. Підключи репозиторій **tg-schedule-app** (якщо не бачиш — натисни "Configure account" і дай доступ до GitHub).
4. Налаштування сервісу:
   - **Name:** `tg-schedule-app` (або будь-яка назва).
   - **Region:** Frankfurt (EU) або найближчий.
   - **Branch:** `main`.
   - **Runtime:** Node.
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance type:** Free (достатньо для початку).

5. **Environment** (змінні середовища) — обовʼязково додай:
   - `BOT_TOKEN` = твій токен бота від BotFather (без лапок).
   - `ADMIN_PASSWORD` = пароль для адмін-панелі (наприклад `admin123` або свій).

   **Не** потрібно вручну задавати `WEBAPP_URL` або `RENDER_EXTERNAL_URL` — Render сам підставить свій HTTPS-адрес, і бот використає його для кнопки та webhook.

6. Натисни **Create Web Service**. Почекай 2–4 хвилини, поки збереться й запуститься сервіс.

7. Коли статус стане **Live**, скопіюй URL сервісу (типу `https://tg-schedule-app-xxxx.onrender.com`). Це і є твій постійний адрес додатку.

---

## 3. Перевірка

- Відкрий у браузері посилання типу `https://tg-schedule-app-xxxx.onrender.com` — має відкритися сторінка «Розклад занять».
- У Telegram напиши боту `/start` — має зʼявитися кнопка **«Відкрити розклад»**. Натисни її — відкриється той самий розклад по HTTPS.

Адмін-панель: `https://твій-url.onrender.com/admin.html` (пароль — той, що вказав у `ADMIN_PASSWORD`).

---

## Якщо кнопка показує «17 Розклад» або не «Відкрити розклад»

Це кнопка меню з **BotFather**. Щоб зʼявилась синя кнопка «Відкрити розклад»:

1. Відкрий [@BotFather](https://t.me/BotFather) у Telegram.
2. Напиши `/mybots` → обери свого бота «Розклад».
3. **Bot Settings** → **Menu Button** → вибери **Configure menu button** (або **Edit**).
4. Встанови **Default** (або видали кастомну кнопку), щоб кнопку керував наш сервер через API.
5. Збережи. Потім у чаті з ботом знову напиши `/start` — має зʼявитись кнопка «Відкрити розклад».

Якщо кнопка все одно не та: перевір у логах сервера (Render → Logs), чи є помилка після «Помилка встановлення кнопки меню». Домен твого HTTPS (наприклад `xxxx.onrender.com`) має бути дозволений для Web App у налаштуваннях бота (BotFather → бот → Bot Settings → Edit Bot → тощо).

---

## Версія додатку (у футері)

- У репозиторії є `version.json` і `package.json` → поле `version` (формат `0.0.1`).
- У футері показується **0.00.1** (другий блок завжди з двома цифрами).
- Після кожного **push у гілку `main`** GitHub Actions автоматично збільшує **patch** на 1 (`0.0.1` → `0.0.2`) і робить коміт `chore: bump version [skip version]`, щоб не було подвійного bump.
- Перевірка: `GET /api/version` або `GET /api/health` у відповіді є `display`.
- Якщо Actions не запускаються — у репозиторії: **Settings → Actions → General** → дозвіл на workflow.

---

## Важливо

- На **безкоштовному** плані Render сервіс «засинає» після ~15 хв без запитів. Перше відкриття після цього може тривати 30–60 секунд — це нормально.
- Якщо зміниш код — зроби `git add .`, `git commit -m "опис"`, `git push`; Render автоматично перезбере й перезапустить сервіс (якщо в налаштуваннях увімкнено Auto-Deploy).
