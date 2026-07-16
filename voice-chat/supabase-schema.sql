-- 在 Supabase 项目的 SQL Editor 里整段粘贴执行一次即可。

create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  name text not null default '新对话',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists messages (
  id bigint generated always as identity primary key,
  session_id uuid not null references sessions(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  image_url text,
  image_urls jsonb,
  visible boolean not null default true,
  created_at timestamptz not null default now()
);

alter table messages add column if not exists image_url text;
alter table messages add column if not exists image_urls jsonb;

create table if not exists memories (
  id bigint generated always as identity primary key,
  session_id uuid not null references sessions(id) on delete cascade,
  summary text not null,
  created_at timestamptz not null default now()
);

create table if not exists settings (
  id int primary key default 1,
  system_prompt text not null default '',
  updated_at timestamptz not null default now()
);

insert into settings (id, system_prompt)
values (1, '')
on conflict (id) do nothing;

create index if not exists messages_session_id_idx on messages (session_id, created_at);
create index if not exists memories_session_id_idx on memories (session_id, created_at);
