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
