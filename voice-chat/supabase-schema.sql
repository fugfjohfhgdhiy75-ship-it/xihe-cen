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
alter table settings add column if not exists weather_city text;

-- Per-site API overrides editable from the More page — when set they take
-- priority over the server's ANTHROPIC_BASE_URL / ANTHROPIC_API_KEY /
-- MODEL env vars, so she can switch relays/models without touching Render.
alter table settings add column if not exists api_base_url text;
alter table settings add column if not exists api_key text;
alter table settings add column if not exists model text;

-- 自动发照片的形象设定(更多页可改):photo_appearance 是外貌文字描述,
-- 会自动拼进每张生成照片的画面描述里;photo_reference_url 是一张参考
-- 脸照(存 chat-images 桶),配置后每张生成的照片都会保持这张脸。
alter table settings add column if not exists photo_appearance text;
alter table settings add column if not exists photo_reference_url text;

-- 聊天页自定义背景(更多页的"背景工坊"生成/上传/启用,存 chat-images 桶)
-- 白天用 chat_bg_url,夜间模式(23:00-6:00)自动切换到 chat_bg_night_url
alter table settings add column if not exists chat_bg_url text;
alter table settings add column if not exists chat_bg_night_url text;

-- 聊天气泡文字自定义(更多页"聊天字体与颜色"):user_text_color / assistant_text_color
-- 是十六进制颜色(如 #1f4a73),留空则用主题默认色;font_zh / font_en 是 CSS
-- font-family 字符串,分别控制中文和英文字符用什么字体,两者拼在一起当聊天
-- 区域的 font-family(浏览器按字符自动挑用哪个)。
alter table settings add column if not exists user_text_color text;
alter table settings add column if not exists assistant_text_color text;
alter table settings add column if not exists font_zh text;
alter table settings add column if not exists font_en text;

-- 配色推荐(同一卡片):user_bubble_color / assistant_bubble_color 是气泡
-- 背景色,rgba()/rgb()/hex 均可(需要透明度才能保持磨砂玻璃质感)。这两列和
-- 上面的 *_text_color 一起,由"配色推荐"预设一次性写入四个值,让气泡颜色和
-- 字体颜色搭配好,而不是像手动拾色器那样只改字体颜色、容易和玻璃/背景图打架。
alter table settings add column if not exists user_bubble_color text;
alter table settings add column if not exists assistant_bubble_color text;

-- 引用回复(微信式):点某条消息的"..."菜单选"引用",发下一条消息时会带上
-- 被引用消息的文字快照(reply_to_text)和是谁说的(reply_to_role,
-- 'user'/'assistant')。存快照而不是存 id,是因为原消息以后可能被编辑/
-- 删除,快照能保证引用内容一直显示、不会指向一条已经变了的消息。
alter table messages add column if not exists reply_to_text text;
alter table messages add column if not exists reply_to_role text;

-- 语音条(微信式):audio_url 是录音/合成语音文件,is_voice 标记这条消息
-- 以语音条形式展示;proactive 标记"他主动发起"的消息(用于控制频率)
alter table messages add column if not exists audio_url text;
alter table messages add column if not exists is_voice boolean not null default false;
alter table messages add column if not exists proactive boolean not null default false;

-- "他会主动找你"开关(更多页)
alter table settings add column if not exists proactive_enabled boolean not null default true;

-- "活人感"临场追加消息:跟 proactive(安静了很久之后主动找你)是两码事——
-- 这个是聊天聊得正热的时候,回完一句正常回复后,偶尔紧接着再多发 1-2 条
-- "临时想到的"话(情绪明显起伏的时候才会触发),不占 proactive 的每日额度,
-- 单独算自己的每日上限(见 server.js 的 SPONTANEOUS_DAILY_MAX)。
alter table messages add column if not exists spontaneous boolean not null default false;

-- App 内的 6 位数字密码锁(更多页设置,跟整站的"暗号"是两码事——那个是防止
-- 陌生人碰到网址就能打开,一年才要求重新输一次;这个是每次重新打开/切回
-- 这个 App 都要求重新输,防的是别人拿着你已经解锁的手机随手点开)。只存哈希
-- 值,不存明文 PIN;这一列是否有值就代表锁有没有开启。
alter table settings add column if not exists app_lock_pin_hash text;

-- 纪念册:两人共同确认过的重要事件。"他"在聊天里提议(pending),她在
-- 聊天气泡下点"记下来"确认(confirmed)后永久生效——confirmed 的条目
-- 会拼进每一个窗口每一轮对话的提示词里,永不压缩、跨窗口共用。
create table if not exists milestones (
  id bigint generated always as identity primary key,
  content text not null,
  status text not null default 'pending' check (status in ('pending', 'confirmed')),
  created_at timestamptz not null default now()
);

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

-- Weather emoji at the moment this entry was written (see getWeather in
-- server.js) — only set if a 所在城市 is configured on the More page.
alter table diary_entries add column if not exists weather text;

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
-- 服务器从网易云拿到的真实歌词摘录(两行),不再让模型凭记忆背歌词
alter table daily_songs add column if not exists lyric text;

-- One row per calendar day: the Home page love-quote card. Replaces the
-- old fixed local list with a fresh one each day (still a real,
-- correctly-attributed quote — see pickDailyQuote in server.js) so it
-- doesn't repeat nearly as fast; `rejected` stores quotes already skipped
-- today via the card's refresh button, same pattern as daily_songs.
create table if not exists daily_quotes (
  id bigint generated always as identity primary key,
  quote_date date not null unique,
  en text not null,
  zh text not null,
  rejected jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

-- 表情包:预先生成好的一批固定图(跟自动拍照片不是一回事——那个是现拍新
-- 画面,这个是一套提前存好的固定反应图),模型想用某种情绪的时候在回复里
-- 加 [表情:tag] 标记,服务器直接从这里按 tag 取图发送,不用现生成,不占
-- 自动拍照的冷却时间、也不用等生成。tag 举例:害羞、笑哭、生气、比心等。
create table if not exists stickers (
  id bigint generated always as identity primary key,
  tag text not null unique,
  image_url text not null,
  created_at timestamptz not null default now()
);

create index if not exists messages_session_id_idx on messages (session_id, created_at);
create index if not exists memories_session_id_idx on memories (session_id, created_at);
create index if not exists diary_entries_date_idx on diary_entries (entry_date desc);
create index if not exists diary_entries_created_idx on diary_entries (created_at desc);
create index if not exists daily_songs_date_idx on daily_songs (song_date desc);
create index if not exists daily_quotes_date_idx on daily_quotes (quote_date desc);
