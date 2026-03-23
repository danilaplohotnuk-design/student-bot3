-- Екзамени: збереження після деплою (Render без платного Disk).
-- Використовуються ті самі SUPABASE_URL та SUPABASE_SERVICE_ROLE_KEY, що й для «Важливо».
-- SQL Editor → New query → Run

create table if not exists schedule_exams (
  id text primary key,
  exam_date text not null,
  subject text not null,
  time_text text not null,
  topic text not null default '',
  zoom_url text not null default '',
  created_at bigint not null default 0
);

create index if not exists schedule_exams_exam_date_idx on schedule_exams (exam_date);

alter table schedule_exams enable row level security;
