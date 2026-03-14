# Деплой на Koyeb.com

Після деплою додаток працюватиме по посиланню, бот у Telegram відкриватиме розклад по кнопці.

---

## 1. Підключити GitHub до Koyeb

1. Зайди на **https://app.koyeb.com** і увійди в акаунт.
2. Якщо GitHub ще не підключений: **Profile** (або **Integrations**) → **GitHub** → дозволь доступ до репозиторіїв (наприклад, до `student-bot3` або організації).

---

## 2. Створити Web Service

1. У Koyeb натисни **Create App** (або **Create** → **Web Service**).
2. **Deploy from**: вибери **GitHub**.
3. Обери репозиторій **student-bot3** (або той, куди ти закинув проєкт).
4. **Branch:** `main`.

---

## 3. Налаштування збірки та запуску

- **Builder:** Docker або **Buildpack** (якщо є вибір — можна залишити автовизначення; Koyeb побачить `package.json` і збере як Node.js).
- **Build command:** залиш порожнім або вкажи `npm install`.
- **Run command:** `npm start`.

Якщо Koyeb показує лише одне поле типу **Start command** — вкажи `npm start`.

---

## 4. Змінні середовища (Environment variables)

У секції **Environment variables** додай:

| Name            | Value                    |
|-----------------|--------------------------|
| `BOT_TOKEN`     | твій токен від BotFather |
| `ADMIN_PASSWORD`| пароль для адмін-панелі (наприклад `admin123`) |

**Після першого деплою** (коли з’явиться URL сервісу) додай ще одну змінну:

| Name         | Value                                      |
|--------------|--------------------------------------------|
| `WEBAPP_URL` | твій URL від Koyeb (наприклад `https://student-bot3-xxx.koyeb.app`) |

Без `WEBAPP_URL` кнопка в Telegram і webhook не працюватимуть коректно. URL можна взяти на сторінці сервісу в Koyeb (Public URL / Domain).

---

## 5. Регіон і план

- **Region:** обери найближчий (наприклад Frankfurt).
- **Instance type:** безкоштовний план (якщо доступний) або мінімальний.

Натисни **Deploy** (або **Create Web Service**).

---

## 6. Після деплою

1. Дочекайся, поки статус стане **Running** (зелена галочка).
2. Скопіюй **Public URL** сервісу (типу `https://student-bot3-xxxx.koyeb.app`).
3. Якщо ще не додавав **WEBAPP_URL** — зайди в **Settings** сервісу → **Environment variables** → додай `WEBAPP_URL` = цей URL → збережи. Koyeb перезапустить сервіс.
4. Відкрий URL у браузері — має відкритися сторінка «Розклад занять».
5. У Telegram напиши боту `/start` і натисни «Відкрити розклад» — відкриється твій додаток по HTTPS.

Адмін-панель: `https://твій-url.koyeb.app/admin.html` (пароль — той, що вказав у `ADMIN_PASSWORD`).

---

## Якщо щось не працює

- Переконайся, що в змінних є **BOT_TOKEN** і **WEBAPP_URL** (з `https://`).
- Логи: у Koyeb відкрий свій сервіс → вкладка **Logs** — там буде видно помилки запуску або webhook.
