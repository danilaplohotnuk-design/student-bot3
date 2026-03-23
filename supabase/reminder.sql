-- Виконай у Supabase: SQL Editor → New query → Run
-- Потрібно для збереження «Важливо» без платного Disk на Render.
-- У Render додай SUPABASE_URL та SUPABASE_SERVICE_ROLE_KEY (Settings → API).

create table if not exists reminder_current (
  id smallint primary key default 1 check (id = 1),
  body text not null default '',
  updated_at bigint not null default 0
);

insert into reminder_current (id, body, updated_at)
values (1, '', 0)
on conflict (id) do nothing;

create table if not exists reminder_history (
  id bigserial primary key,
  body text not null,
  updated_at bigint not null
);

create index if not exists reminder_history_updated_at_idx on reminder_history (updated_at desc);

-- Закрити публічний доступ; сервер із Service Role обходить RLS.
alter table reminder_current enable row level security;
alter table reminder_history enable row level security;
