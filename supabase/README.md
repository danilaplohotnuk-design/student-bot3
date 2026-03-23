# Supabase для «Важливо»

1. [supabase.com](https://supabase.com) → New project (free).
2. **SQL Editor** → встав вміст `reminder.sql` → **Run**.
3. **Project Settings → API**:
   - **Project URL** → це `SUPABASE_URL` у Render.
   - **service_role** (secret) → це `SUPABASE_SERVICE_ROLE_KEY` у Render.  
     Не публікуй і не вставляй у фронтенд — лише змінні середовища сервера.

4. У Render → **Environment** додай обидві змінні → **Deploy**.

Після старту в логах сервера буде рядок: `«Важливо»: Supabase`.

Якщо змінних немає — використовується файл `reminder.json` (локально або `DATA_DIR`).
