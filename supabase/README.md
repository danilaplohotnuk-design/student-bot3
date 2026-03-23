# Supabase для «Важливо» та екзаменів

Ті самі змінні `SUPABASE_URL` та `SUPABASE_SERVICE_ROLE_KEY` на сервері (Render).

1. [supabase.com](https://supabase.com) → New project (free).
2. **SQL Editor**:
   - встав вміст `reminder.sql` → **Run**;
   - встав вміст `exams.sql` → **Run** (таблиця `schedule_exams` — екзамени **не зникають** після деплою без платного Disk).
3. **Project Settings → API**:
   - **Project URL** → це `SUPABASE_URL` у Render.
   - **service_role** (secret) → це `SUPABASE_SERVICE_ROLE_KEY` у Render.  
     Не публікуй і не вставляй у фронтенд — лише змінні середовища сервера.

4. У Render → **Environment** додай обидві змінні → **Deploy**.

Після старту в логах сервера буде рядок: `«Важливо»: Supabase`.

Якщо змінних немає — використовуються файли `reminder.json` та `exams.json` (локально або `DATA_DIR`). На Render без Disk після деплою ці файли **не зберігаються** — тоді обов’язково Supabase + виконані обидва SQL.
