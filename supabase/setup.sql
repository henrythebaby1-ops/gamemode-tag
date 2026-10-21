-- Gamemode Tag — Supabase database setup
-- Paste this whole file into Supabase: SQL Editor -> New query -> Run.
-- Safe to run again: it only adds what is missing and replaces the functions.
--
-- Everything goes through the gt_* functions below. The tables themselves are
-- locked (row level security on, no policies), so visitors can't edit them directly.

create extension if not exists pgcrypto with schema extensions;

-- ---------- tables ----------

create table if not exists public.gt_settings (
  id               int primary key default 1 check (id = 1),
  open             boolean not null default true,
  round            int not null default 1,
  day              date,
  last_winner      jsonb,
  daily_reset      boolean not null default true,
  reset_hour       int not null default 0 check (reset_hour between 0 and 23),
  timezone         text not null default 'America/Los_Angeles',  -- Pacific (PST/PDT)
  refresh_seconds  int not null default 60,
  max_votes_per_ip int not null default 5
);

create table if not exists public.gt_gamemodes (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(name) between 1 and 40),
  description text not null default '' check (length(description) <= 160),
  created_at  timestamptz not null default now()
);

create table if not exists public.gt_votes (
  voter_hash  text primary key,
  gamemode_id uuid not null references public.gt_gamemodes(id) on delete cascade,
  ip_hash     text not null,
  created_at  timestamptz not null default now()
);

create table if not exists public.gt_admin (
  id        int primary key default 1 check (id = 1),
  username  text not null,
  pass_hash text not null
);

create table if not exists public.gt_admin_sessions (
  token_hash text primary key,
  expires_at timestamptz not null
);

alter table public.gt_settings       enable row level security;
alter table public.gt_gamemodes      enable row level security;
alter table public.gt_votes          enable row level security;
alter table public.gt_admin          enable row level security;
alter table public.gt_admin_sessions enable row level security;

insert into public.gt_settings (id) values (1) on conflict do nothing;

insert into public.gt_gamemodes (name, description)
select * from (values
  ('Classic Tag', 'One tagger. Get tagged, you''re it.'),
  ('Freeze Tag',  'Tagged players freeze until a teammate unfreezes them.'),
  ('Infection',   'Tagged players join the taggers. Last runner wins.')
) v(name, description)
where not exists (select 1 from public.gt_gamemodes);

-- ---------- private helpers ----------

create or replace function public.gt_hash(t text) returns text
language sql immutable set search_path = public, extensions as $$
  select encode(extensions.digest(t, 'sha256'), 'hex')
$$;

-- Hash of the visitor's IP address (from the request headers Supabase passes in).
create or replace function public.gt_ip_hash() returns text
language plpgsql stable set search_path = public, extensions as $$
declare
  h  json := nullif(current_setting('request.headers', true), '')::json;
  ip text := coalesce(split_part(h->>'x-forwarded-for', ',', 1), h->>'cf-connecting-ip', 'unknown');
begin
  return left(gt_hash('gt-ip|' || trim(ip)), 16);
end $$;

-- The "day" a moment belongs to, counted from reset_hour in the chosen time zone.
create or replace function public.gt_day(ts timestamptz, s public.gt_settings) returns date
language sql stable as $$
  select ((ts at time zone s.timezone) - make_interval(hours => s.reset_hour))::date
$$;

create or replace function public.gt_next_reset(s public.gt_settings) returns timestamptz
language sql stable as $$
  select ((public.gt_day(now(), s) + 1)::timestamp + make_interval(hours => s.reset_hour)) at time zone s.timezone
$$;

-- Clears votes once per day. Runs whenever anyone loads the page, so no cron job is needed.
create or replace function public.gt_daily_reset() returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  s public.gt_settings;
  today date;
  top_name text;
  top_votes int;
begin
  select * into s from gt_settings where id = 1;
  if not s.daily_reset then return; end if;
  today := gt_day(now(), s);
  if s.day = today then return; end if;

  select * into s from gt_settings where id = 1 for update;   -- lock, then re-check
  if s.day = today then return; end if;

  if s.day is not null then
    select g.name, count(*)::int into top_name, top_votes
    from gt_votes v join gt_gamemodes g on g.id = v.gamemode_id
    group by g.id, g.name
    order by count(*) desc, min(v.created_at)
    limit 1;

    delete from gt_votes where true;
    update gt_settings set
      round = round + 1,
      open = true,
      last_winner = case when top_name is null then last_winner
                         else jsonb_build_object('name', top_name, 'votes', top_votes, 'day', s.day) end
    where id = 1;
  end if;
  update gt_settings set day = today where id = 1;
end $$;

create or replace function public.gt_is_admin(admin_token text) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select admin_token is not null and exists (
    select 1 from gt_admin_sessions where token_hash = gt_hash(admin_token) and expires_at > now()
  )
$$;

create or replace function public.gt_require_admin(admin_token text) returns void
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  if not gt_is_admin(admin_token) then
    raise exception 'Admin login required.' using errcode = '42501';
  end if;
end $$;

create or replace function public.gt_check_voter(voter_token text) returns text
language plpgsql immutable as $$
begin
  if voter_token is null or length(voter_token) < 16 or length(voter_token) > 100 then
    raise exception 'Bad voter id. Reload the page.';
  end if;
  return public.gt_hash('gt-voter|' || voter_token);
end $$;

-- ---------- public functions (called by the website) ----------

create or replace function public.gt_state(voter_token text default null, admin_token text default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  s public.gt_settings;
  modes jsonb;
  total int;
  mine uuid;
  is_admin boolean := gt_is_admin(admin_token);
begin
  perform gt_daily_reset();
  select * into s from gt_settings where id = 1;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', g.id, 'name', g.name, 'description', g.description,
           'votes', (select count(*) from gt_votes v where v.gamemode_id = g.id)
         ) order by g.created_at), '[]'::jsonb)
    into modes from gt_gamemodes g;
  select count(*) into total from gt_votes;
  if voter_token is not null and length(voter_token) between 16 and 100 then
    select gamemode_id into mine from gt_votes where voter_hash = gt_hash('gt-voter|' || voter_token);
  end if;

  return jsonb_build_object(
    'open', s.open,
    'round', s.round,
    'gamemodes', modes,
    'total', total,
    'myVote', mine,
    'refreshSeconds', s.refresh_seconds,
    'serverTime', extract(epoch from now())::bigint,
    'nextReset', case when s.daily_reset then extract(epoch from gt_next_reset(s))::bigint end,
    'lastWinner', s.last_winner,
    'admin', is_admin,
    'user', case when is_admin then (select username from gt_admin where id = 1) end
  );
end $$;

create or replace function public.gt_vote(voter_token text, gamemode_id uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  vh text := gt_check_voter(voter_token);
  ip text := gt_ip_hash();
  s public.gt_settings;
begin
  perform gt_daily_reset();
  select * into s from gt_settings where id = 1;
  if not s.open then raise exception 'Voting is closed right now.'; end if;
  if not exists (select 1 from gt_gamemodes where id = gt_vote.gamemode_id) then
    raise exception 'That gamemode no longer exists.';
  end if;
  if not exists (select 1 from gt_votes where voter_hash = vh)
     and (select count(*) from gt_votes where ip_hash = ip) >= s.max_votes_per_ip then
    raise exception 'Too many votes from this connection.';
  end if;

  insert into gt_votes (voter_hash, gamemode_id, ip_hash)
  values (vh, gt_vote.gamemode_id, ip)
  on conflict (voter_hash) do update set gamemode_id = excluded.gamemode_id, created_at = now();

  return gt_state(voter_token);
end $$;

create or replace function public.gt_unvote(voter_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  if (select open from gt_settings where id = 1) then
    delete from gt_votes where voter_hash = gt_check_voter(voter_token);
  end if;
  return gt_state(voter_token);
end $$;

create or replace function public.gt_admin_login(username text, password text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  a public.gt_admin;
  tok text;
begin
  select * into a from gt_admin where id = 1;
  if a is null then
    raise exception 'Admin login is not set up yet. Run gt_set_admin_login in the Supabase SQL Editor.';
  end if;
  if a.username is distinct from gt_admin_login.username
     or a.pass_hash is distinct from extensions.crypt(password, a.pass_hash) then
    perform pg_sleep(0.5);   -- slow down password guessing
    raise exception 'Wrong username or password.';
  end if;

  delete from gt_admin_sessions where expires_at < now();
  tok := encode(extensions.gen_random_bytes(24), 'hex');
  insert into gt_admin_sessions values (gt_hash(tok), now() + interval '7 days');
  return jsonb_build_object('token', tok);
end $$;

create or replace function public.gt_admin_logout(admin_token text) returns void
language sql security definer set search_path = public, extensions as $$
  delete from gt_admin_sessions where token_hash = gt_hash(admin_token)
$$;

create or replace function public.gt_admin_add(admin_token text, name text, description text default '') returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  n text := left(regexp_replace(trim(coalesce(name, '')), '\s+', ' ', 'g'), 40);
  d text := left(regexp_replace(trim(coalesce(description, '')), '\s+', ' ', 'g'), 160);
begin
  perform gt_require_admin(admin_token);
  if n = '' then raise exception 'Give the gamemode a name.'; end if;
  if exists (select 1 from gt_gamemodes g where lower(g.name) = lower(n)) then
    raise exception 'A gamemode with that name already exists.';
  end if;
  if (select count(*) from gt_gamemodes) >= 30 then raise exception 'Limit of 30 gamemodes reached.'; end if;
  insert into gt_gamemodes (name, description) values (n, d);
  return gt_state(null, admin_token);
end $$;

create or replace function public.gt_admin_edit(admin_token text, id uuid, name text, description text default '') returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  n text := left(regexp_replace(trim(coalesce(name, '')), '\s+', ' ', 'g'), 40);
  d text := left(regexp_replace(trim(coalesce(description, '')), '\s+', ' ', 'g'), 160);
begin
  perform gt_require_admin(admin_token);
  if n = '' then raise exception 'Give the gamemode a name.'; end if;
  update gt_gamemodes g set name = n, description = d where g.id = gt_admin_edit.id;
  return gt_state(null, admin_token);
end $$;

create or replace function public.gt_admin_delete(admin_token text, id uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform gt_require_admin(admin_token);
  delete from gt_gamemodes g where g.id = gt_admin_delete.id;   -- its votes go too (on delete cascade)
  return gt_state(null, admin_token);
end $$;

create or replace function public.gt_admin_toggle(admin_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform gt_require_admin(admin_token);
  update gt_settings set open = not open where id = 1;
  return gt_state(null, admin_token);
end $$;

create or replace function public.gt_admin_reset(admin_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform gt_require_admin(admin_token);
  delete from gt_votes where true;
  update gt_settings set round = round + 1, open = true where id = 1;
  return gt_state(null, admin_token);
end $$;

-- Sets the admin username and password. Only works from the SQL Editor, never from the website.
create or replace function public.gt_set_admin_login(username text, password text) returns text
language plpgsql security definer set search_path = public, extensions as $$
begin
  if length(password) < 8 then raise exception 'Use a password of at least 8 characters.'; end if;
  insert into gt_admin (id, username, pass_hash)
  values (1, username, extensions.crypt(password, extensions.gen_salt('bf')))
  on conflict (id) do update set username = excluded.username, pass_hash = excluded.pass_hash;
  delete from gt_admin_sessions where true;   -- log out everywhere
  return 'Admin login saved for ' || username;
end $$;

-- ---------- who can call what ----------

revoke all on all functions in schema public from public, anon, authenticated;

grant execute on function
  public.gt_state(text, text),
  public.gt_vote(text, uuid),
  public.gt_unvote(text),
  public.gt_admin_login(text, text),
  public.gt_admin_logout(text),
  public.gt_admin_add(text, text, text),
  public.gt_admin_edit(text, uuid, text, text),
  public.gt_admin_delete(text, uuid),
  public.gt_admin_toggle(text),
  public.gt_admin_reset(text)
to anon, authenticated;

-- Make the website's API see the new functions right away.
notify pgrst, 'reload schema';
