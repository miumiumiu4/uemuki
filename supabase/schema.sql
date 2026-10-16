-- うえむき データベースの設計図
-- Supabase の SQL Editor に丸ごと貼って一度だけ実行してください。
-- 何度実行しても壊れないように書いてあります。

create extension if not exists pgcrypto;

-- ===== プロフィール（名札） =====
create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  display_name text not null default 'なまえ未設定' check (char_length(display_name) between 1 and 20),
  area text check (area is null or char_length(area) <= 20),
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

-- ===== 本人だけの設定（公開する項目と、歩数送信用の合言葉） =====
create table if not exists public.settings (
  user_id uuid primary key references public.profiles on delete cascade,
  share_steps boolean not null default true,
  share_weight boolean not null default false,
  share_muscle boolean not null default false,
  share_fat boolean not null default false,
  share_bp boolean not null default false,
  steps_token uuid not null default gen_random_uuid() unique
);

-- 新しく登録した人のプロフィールと設定を自動で作る
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(nullif(left(new.raw_user_meta_data->>'display_name', 20), ''), 'なまえ未設定'))
  on conflict (id) do nothing;
  insert into public.settings (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false)
$$;

-- ===== みんなの一歩（歩いた・筋トレ・瞑想の投稿） =====
create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles on delete cascade,
  kind text not null check (kind in ('walk', 'training', 'mind')),
  steps int check (steps is null or steps between 0 and 200000),
  km numeric(6, 2) check (km is null or km between 0 and 300),
  minutes int check (minutes is null or minutes between 0 and 1440),
  label text check (label is null or char_length(label) <= 40),
  detail text check (detail is null or char_length(detail) <= 200),
  -- 道の「形」だけ。緯度経度は保存しない（家の場所が分からないように）
  route_path text check (route_path is null or char_length(route_path) <= 4000),
  created_at timestamptz not null default now()
);
create index if not exists posts_created_idx on public.posts (created_at desc);

-- ===== 応援スタンプ =====
create table if not exists public.cheers (
  post_id uuid not null references public.posts on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles on delete cascade,
  stamp text not null check (stamp in ('お楽しみ様', 'ナイス一歩', '今日も歩けたね', '一緒に歩いてるよ',
    'あなたの一歩が力になる', 'ゆっくりでいいよ', 'おかえり', 'ありがとう', '上を向いていこう')),
  created_at timestamptz not null default now(),
  primary key (post_id, user_id, stamp)
);

-- ===== コメント =====
create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles on delete cascade,
  body text not null check (char_length(body) between 1 and 200),
  created_at timestamptz not null default now()
);

-- ===== 掲示板 =====
create table if not exists public.board_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles on delete cascade,
  title text not null check (char_length(title) between 1 and 60),
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);
create table if not exists public.board_replies (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.board_threads on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles on delete cascade,
  body text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now()
);

-- ===== 筋トレメニュー表 =====
create table if not exists public.menu_items (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(name) between 1 and 30),
  part text check (part is null or char_length(part) <= 20),
  how text check (how is null or char_length(how) <= 400),
  tip text check (tip is null or char_length(tip) <= 400),
  video_url text check (video_url is null or video_url ~ '^https://'),
  created_by uuid default auth.uid() references public.profiles on delete set null,
  created_at timestamptz not null default now()
);

-- ===== 毎日の歩数 =====
create table if not exists public.daily_steps (
  user_id uuid not null references public.profiles on delete cascade,
  day date not null,
  steps int not null check (steps between 0 and 200000),
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);

-- ===== 体の記録（本人だけ） =====
create table if not exists public.body_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles on delete cascade,
  day date not null default current_date,
  weight numeric(5, 1) check (weight is null or weight between 20 and 300),
  muscle numeric(5, 1) check (muscle is null or muscle between 5 and 100),
  fat numeric(4, 1) check (fat is null or fat between 1 and 80),
  bp_sys int check (bp_sys is null or bp_sys between 50 and 260),
  bp_dia int check (bp_dia is null or bp_dia between 30 and 200),
  pulse int check (pulse is null or pulse between 20 and 250),
  note text check (note is null or char_length(note) <= 500),
  created_at timestamptz not null default now()
);
create index if not exists body_user_day_idx on public.body_records (user_id, day);

-- ===== 通報とブロック =====
create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles on delete cascade,
  target_type text not null check (target_type in ('post', 'comment', 'thread', 'reply', 'user')),
  target_id uuid not null,
  reason text check (reason is null or char_length(reason) <= 200),
  created_at timestamptz not null default now()
);
create table if not exists public.blocks (
  user_id uuid not null default auth.uid() references public.profiles on delete cascade,
  blocked_id uuid not null references public.profiles on delete cascade,
  primary key (user_id, blocked_id)
);

-- 歩数を公開している人か（設定は本人しか読めないので、はいかいいえだけ返す）
create or replace function public.shares_steps(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select share_steps from public.settings where user_id = p_user), false)
$$;

-- ===== 鍵（だれが何を読める・書けるか） =====
alter table public.profiles enable row level security;
alter table public.settings enable row level security;
alter table public.posts enable row level security;
alter table public.cheers enable row level security;
alter table public.comments enable row level security;
alter table public.board_threads enable row level security;
alter table public.board_replies enable row level security;
alter table public.menu_items enable row level security;
alter table public.daily_steps enable row level security;
alter table public.body_records enable row level security;
alter table public.reports enable row level security;
alter table public.blocks enable row level security;

do $$
declare t text;
begin
  -- 作り直せるように、いったん既存の鍵を外す
  for t in select format('%I on %I.%I', policyname, schemaname, tablename) from pg_policies where schemaname = 'public'
  loop execute 'drop policy ' || t; end loop;
end $$;

-- プロフィール：ログインした人は見られる。自分のものだけ変えられる
create policy profiles_read on public.profiles for select to authenticated using (true);
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
-- 見守り役の印（is_admin）は自分では変えられないように、変えてよい列だけ許可する
revoke update on public.profiles from authenticated, anon;
grant update (display_name, area) on public.profiles to authenticated;

-- 設定：本人だけ
create policy settings_own on public.settings for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 投稿・スタンプ・コメント・掲示板：ログインした人は見られる。書くのは自分の名前で。消すのは自分か見守り役
create policy posts_read on public.posts for select to authenticated using (true);
create policy posts_insert on public.posts for insert to authenticated with check (user_id = auth.uid());
create policy posts_delete on public.posts for delete to authenticated using (user_id = auth.uid() or public.is_admin());

create policy cheers_read on public.cheers for select to authenticated using (true);
create policy cheers_insert on public.cheers for insert to authenticated with check (user_id = auth.uid());
create policy cheers_delete on public.cheers for delete to authenticated using (user_id = auth.uid());

create policy comments_read on public.comments for select to authenticated using (true);
create policy comments_insert on public.comments for insert to authenticated with check (user_id = auth.uid());
create policy comments_delete on public.comments for delete to authenticated using (user_id = auth.uid() or public.is_admin());

create policy threads_read on public.board_threads for select to authenticated using (true);
create policy threads_insert on public.board_threads for insert to authenticated with check (user_id = auth.uid());
create policy threads_delete on public.board_threads for delete to authenticated using (user_id = auth.uid() or public.is_admin());

create policy replies_read on public.board_replies for select to authenticated using (true);
create policy replies_insert on public.board_replies for insert to authenticated with check (user_id = auth.uid());
create policy replies_delete on public.board_replies for delete to authenticated using (user_id = auth.uid() or public.is_admin());

-- メニュー表：だれでも種目を増やせる。直す・消すのは追加した人か見守り役
create policy menu_read on public.menu_items for select to authenticated using (true);
create policy menu_insert on public.menu_items for insert to authenticated with check (created_by = auth.uid());
create policy menu_update on public.menu_items for update to authenticated using (created_by = auth.uid() or public.is_admin());
create policy menu_delete on public.menu_items for delete to authenticated using (public.is_admin());

-- 歩数：公開している人の分はみんなが見られる。書くのは自分だけ
create policy steps_read on public.daily_steps for select to authenticated using (
  user_id = auth.uid() or public.shares_steps(user_id));
create policy steps_write on public.daily_steps for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 体の記録：本人だけ。公開する分は下の関数を通して、選んだ項目だけを出す
create policy body_own on public.body_records for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 通報：だれでも送れる。見るのは見守り役だけ
create policy reports_insert on public.reports for insert to authenticated with check (user_id = auth.uid());
create policy reports_read on public.reports for select to authenticated using (public.is_admin());

-- ブロック：本人だけ
create policy blocks_own on public.blocks for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ===== 関数 =====

-- 公開を選んだ項目だけ、ほかの人の体の記録を返す
create or replace function public.shared_body(p_user uuid)
returns table (day date, weight numeric, muscle numeric, fat numeric, bp_sys int, bp_dia int)
language sql stable security definer set search_path = public as $$
  select b.day,
    case when s.share_weight then b.weight end,
    case when s.share_muscle then b.muscle end,
    case when s.share_fat then b.fat end,
    case when s.share_bp then b.bp_sys end,
    case when s.share_bp then b.bp_dia end
  from public.body_records b join public.settings s on s.user_id = b.user_id
  where b.user_id = p_user and auth.uid() is not null
    and (s.share_weight or s.share_muscle or s.share_fat or s.share_bp)
  order by b.day
$$;

-- iPhoneのショートカットから歩数を送る入口（合言葉で本人を確かめる）
create or replace function public.submit_steps(p_token uuid, p_steps int, p_day date default null)
returns text language plpgsql security definer set search_path = public as $$
declare uid uuid; d date := coalesce(p_day, (now() at time zone 'Asia/Tokyo')::date);
begin
  select user_id into uid from public.settings where steps_token = p_token;
  if uid is null then raise exception '合言葉が違います'; end if;
  if p_steps is null or p_steps < 0 or p_steps > 200000 then raise exception '歩数が正しくありません'; end if;
  if d > (now() at time zone 'Asia/Tokyo')::date or d < (now() at time zone 'Asia/Tokyo')::date - 7 then raise exception '日付が正しくありません'; end if;
  insert into public.daily_steps (user_id, day, steps) values (uid, d, p_steps)
  on conflict (user_id, day) do update set steps = excluded.steps, updated_at = now();
  return 'お楽しみ様。' || p_steps || '歩を受け取りました';
end $$;

-- 合言葉を作り直す（漏れたとき用）
create or replace function public.reset_steps_token() returns uuid
language sql security definer set search_path = public as $$
  update public.settings set steps_token = gen_random_uuid() where user_id = auth.uid() returning steps_token
$$;

-- みんなで目標：全員の歩数の合計（個人は分からない形で）
create or replace function public.group_total_steps() returns bigint
language sql stable security definer set search_path = public as $$
  select coalesce(sum(steps), 0)::bigint from public.daily_steps where auth.uid() is not null
$$;

revoke all on function public.submit_steps(uuid, int, date) from public;
grant execute on function public.submit_steps(uuid, int, date) to anon, authenticated;
revoke all on function public.shared_body(uuid) from public, anon;
grant execute on function public.shared_body(uuid) to authenticated;
revoke all on function public.reset_steps_token() from public, anon;
grant execute on function public.reset_steps_token() to authenticated;
revoke all on function public.group_total_steps() from public, anon;
grant execute on function public.group_total_steps() to authenticated;

-- 退会（アカウント削除）の入口。本人だけが自分を消せる。
-- 投稿・スタンプ・コメント・体の記録など、その人のデータはすべて一緒に消える（メニュー表に増やした種目は残る）。
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  if auth.uid() is null then raise exception 'ログインしていません'; end if;
  delete from auth.users where id = auth.uid();
end $$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- ===== 最初のメニュー表 =====
insert into public.menu_items (name, part, how, tip, created_by) values
  ('スクワット', '脚・お尻', '足を肩幅に開き、椅子に座るようにお尻を後ろへ。膝はつま先より前に出しすぎない。', '息を止めずに、下がるときに吸って、上がるときに吐く。', null),
  ('かかと上げ', 'ふくらはぎ', '壁に手をついて、かかとをゆっくり上げて下ろす。20回。', 'ふくらはぎは「第二の心臓」。歩けない日はこれだけでも。', null),
  ('プランク', '体幹', '肘とつま先で体を一直線に支える。30秒から。', 'お尻が上がりすぎない、下がりすぎない。呼吸は止めない。', null),
  ('踏み台昇降', '脚・心肺', '階段の一段を使って、上がって下りるをくり返す。5分から。', '手すりのある場所で。雨の日の歩数がわりに。', null),
  ('腕立て（膝つき）', '胸・腕', '膝をついた姿勢で、胸を床に近づけて戻す。10回。', '無理せず回数より形を大事に。', null)
on conflict (name) do nothing;
