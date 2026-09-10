-- Apply once to a new Supabase project. All private data is scoped by auth.uid().
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null check (jsonb_typeof(data) = 'object' and octet_length(data::text) < 16000)
);
create table public.runs (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  data jsonb not null check (jsonb_typeof(data) = 'object' and octet_length(data::text) < 12000000),
  check (data->>'id' = id::text and data->>'owner' = user_id::text)
);
create index runs_owner on public.runs(user_id);
create table public.public_routes (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (length(title) between 1 and 80),
  region text not null check (region in ('서울','인천','대구','성남')),
  route jsonb not null check (jsonb_typeof(route) = 'object' and octet_length(route::text) < 1000000),
  created_at timestamptz not null default now()
);
create table public.route_likes (
  route_id uuid references public.public_routes(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  primary key (route_id, user_id)
);
alter table public.profiles enable row level security;
alter table public.runs enable row level security;
alter table public.public_routes enable row level security;
alter table public.route_likes enable row level security;
create policy profiles_owner on public.profiles for all to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy runs_owner on public.runs for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy routes_read on public.public_routes for select to anon, authenticated using (true);
create policy routes_insert on public.public_routes for insert to authenticated with check (user_id = (select auth.uid()));
create policy routes_update on public.public_routes for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy routes_delete on public.public_routes for delete to authenticated using (user_id = (select auth.uid()));
create policy likes_owner on public.route_likes for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select, insert, update, delete on public.profiles, public.runs, public.public_routes, public.route_likes to authenticated;
grant select on public.public_routes to anon;
-- Aggregate counts are public; individual likers are not. Fixed SQL and search_path.
create function public.route_feed(selected_region text)
returns table (id uuid, user_id uuid, title text, region text, route jsonb, likes bigint)
language sql stable security definer set search_path = ''
as $$
 select r.id, r.user_id, r.title, r.region, r.route, count(l.user_id) as likes
 from public.public_routes r left join public.route_likes l on l.route_id = r.id
 where r.region = selected_region
 group by r.id order by count(l.user_id) desc, r.created_at desc limit 20;
$$;
revoke all on function public.route_feed(text) from public;
grant execute on function public.route_feed(text) to anon, authenticated;

-- Explicit user action only. Cascades remove their profile, runs, public courses, likes.
create function public.delete_my_account() returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  delete from auth.users where id = auth.uid();
end;
$$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- Seed a profile row on first signup (email or OAuth). Nickname is display-only, never used for RLS.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, data)
  values (
    new.id,
    jsonb_build_object(
      'nickname', coalesce(
        new.raw_user_meta_data->>'full_name',
        new.raw_user_meta_data->>'name',
        new.raw_user_meta_data->>'nickname',
        ''
      ),
      'region', '서울',
      'pace', 360,
      'paces', jsonb_build_object(
        'usual', 360,
        'fiveK', null,
        'tenK', null,
        'half', null,
        'full', null
      ),
      'onboarded', false,
      'detour', 0.1,
      'voice', false,
      'vibration', false,
      'wake', true,
      'avoidStairs', true
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();
