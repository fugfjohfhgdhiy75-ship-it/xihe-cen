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

-- Toggles shown on the More/设置 page. All default to on so existing
-- deployments get the new features enabled without needing to visit
-- settings first.
alter table settings add column if not exists show_mood boolean not null default true;
alter table settings add column if not exists auto_diary boolean not null default true;
alter table settings add column if not exists sleep_state_enabled boolean not null default true;
alter table settings add column if not exists daily_song_enabled boolean not null default true;
alter table settings add column if not exists together_since date;

-- Diary entries "苏晏" writes unprompted, reflecting on recent conversation
-- (or just whatever's on her mind if nothing's been said in a while), plus
-- a mood emoji and a 0-100 relationship "temperature". Not one-per-day —
-- entry_date is just for display grouping, created_at is the real
-- ordering/spacing signal (see generateDiaryEntry in server.js for the
-- pacing rule). user_reply/ai_reply thread onto the same row since each
-- entry only ever gets one reply-and-response.
create table if not exists diary_entries (
  id bigint generated always as identity primary key,
  entry_date date not null,
  mood_emoji text,
  temperature int,
  content text not null,
  user_reply text,
  user_replied_at timestamptz,
  ai_reply text,
  ai_replied_at timestamptz,
  created_at timestamptz not null default now()
);

-- One row per calendar day: the song "苏晏" recommends that day. `rejected`
-- stores titles already skipped today via "换一首" so a reroll doesn't
-- immediately suggest the same thing back.
create table if not exists daily_songs (
  id bigint generated always as identity primary key,
  song_date date not null unique,
  title text not null,
  artist text not null,
  reason text,
  rejected jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

-- Looked up best-effort against NetEase's own public search (see
-- lookupNeteaseSongId in server.js) so the "去网易云听" link on the Home
-- page can jump straight to that exact song in the app instead of landing
-- on a search results page. Null when no confident match was found — the
-- frontend falls back to a plain search link in that case.
alter table daily_songs add column if not exists netease_id text;

create index if not exists messages_session_id_idx on messages (session_id, created_at);
create index if not exists memories_session_id_idx on memories (session_id, created_at);
create index if not exists diary_entries_date_idx on diary_entries (entry_date desc);
create index if not exists diary_entries_created_idx on diary_entries (created_at desc);
create index if not exists daily_songs_date_idx on daily_songs (song_date desc);
