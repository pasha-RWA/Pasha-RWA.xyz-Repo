-- ============================================================================
-- World Cup 2026 Survivor Pool — functions, triggers, and Row Level Security
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Round helpers
-- ---------------------------------------------------------------------------
-- The canonical round order.
create or replace function round_order() returns text[]
  language sql immutable as $$ select array['GROUP','R32','R16','QF','SF','FINAL']::text[] $$;

create or replace function prev_round_key(p_round text) returns text
  language sql immutable as $$
  select case p_round
    when 'R32'   then 'GROUP'
    when 'R16'   then 'R32'
    when 'QF'    then 'R16'
    when 'SF'    then 'QF'
    when 'FINAL' then 'SF'
    else null end
$$;

-- A round counts as "locked" (picks hidden no longer) when an admin locked it,
-- it's resolved, OR the lock_at deadline has passed.
create or replace function round_locked(p_contest uuid, p_round text)
returns boolean language sql stable as $$
  select coalesce(
    (select status in ('locked','resolved')
            or (lock_at is not null and now() >= lock_at)
       from rounds where contest_id = p_contest and key = p_round),
    false)
$$;

create or replace function is_contest_admin(p_contest uuid)
returns boolean language sql stable as $$
  select exists (
    select 1 from contest_admins
    where contest_id = p_contest and user_id = auth.uid()
  )
$$;

-- ---------------------------------------------------------------------------
-- Elimination logic — the heart of the contest.
-- Returns the round key in which an entry was eliminated, or NULL if alive.
-- SECURITY DEFINER so it can read picks/advancers regardless of pick RLS:
-- this exposes only the *round* of elimination, never the hidden picks.
-- ---------------------------------------------------------------------------
create or replace function entry_eliminated_round(p_entry uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare
  v_contest uuid;
  k text;
  v_status text;
  v_pick_count int;
  v_bad int;
  v_required int;
begin
  select contest_id into v_contest from entries where id = p_entry;
  if v_contest is null then return null; end if;

  foreach k in array round_order() loop
    select status into v_status from rounds where contest_id = v_contest and key = k;
    -- Only resolved rounds can eliminate. Hitting an unresolved round means the
    -- entry has survived everything decided so far => still alive.
    if v_status is distinct from 'resolved' then
      return null;
    end if;

    v_required := case when k = 'GROUP' then 4 else 1 end;

    select count(*) into v_pick_count
      from picks where entry_id = p_entry and round_key = k;
    if v_pick_count < v_required then
      return k;  -- failed to submit the required number of picks
    end if;

    select count(*) into v_bad
      from picks p
      where p.entry_id = p_entry and p.round_key = k
        and not exists (
          select 1 from round_advancers a
          where a.contest_id = v_contest and a.round_key = k and a.team_id = p.team_id);
    if v_bad > 0 then
      return k;  -- at least one selected team did not advance
    end if;
  end loop;

  return null;  -- survived the Final
end;
$$;

-- Convenience view for standings / status (status only; picks stay protected).
create or replace view v_entry_status as
  select e.id, e.contest_id, e.user_id, e.display_name, e.created_at,
         entry_eliminated_round(e.id) as eliminated_round,
         (entry_eliminated_round(e.id) is null) as alive
  from entries e;

-- ---------------------------------------------------------------------------
-- Pick validation trigger (defends against direct table writes)
-- ---------------------------------------------------------------------------
create or replace function trg_validate_pick()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_contest uuid;
  v_status  text;
  v_lock    timestamptz;
  v_count   int;
  v_prev    text;
begin
  select contest_id into v_contest from entries where id = NEW.entry_id;
  if v_contest is null then raise exception 'Unknown entry'; end if;

  select status, lock_at into v_status, v_lock
    from rounds where contest_id = v_contest and key = NEW.round_key;

  if v_status is null then raise exception 'Round % not configured', NEW.round_key; end if;
  if v_status <> 'open' then raise exception 'Round % is not open for picks', NEW.round_key; end if;
  if v_lock is not null and now() >= v_lock then
    raise exception 'Round % picks are locked', NEW.round_key;
  end if;

  -- per-round count limit
  select count(*) into v_count from picks
    where entry_id = NEW.entry_id and round_key = NEW.round_key;
  if NEW.round_key = 'GROUP' then
    if v_count >= 4 then raise exception 'Group stage already has 4 picks'; end if;
  else
    if v_count >= 1 then raise exception 'Round % already has a pick', NEW.round_key; end if;
    -- knockout participation: team must have advanced FROM the previous round
    v_prev := prev_round_key(NEW.round_key);
    if not exists (select 1 from round_advancers a
                   where a.contest_id = v_contest and a.round_key = v_prev and a.team_id = NEW.team_id) then
      raise exception 'Team % is not playing in round %', NEW.team_id, NEW.round_key;
    end if;
  end if;

  return NEW;
end;
$$;

drop trigger if exists validate_pick on picks;
create trigger validate_pick before insert on picks
  for each row execute function trg_validate_pick();

-- ---------------------------------------------------------------------------
-- RPCs used by the frontend (centralized, validated, security definer)
-- ---------------------------------------------------------------------------

-- Join a contest (creates the caller's entry).
create or replace function join_contest(p_contest uuid, p_display_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  insert into entries (contest_id, user_id, display_name)
    values (p_contest, auth.uid(), coalesce(nullif(trim(p_display_name),''), 'Entry'))
    on conflict (contest_id, user_id) do update set display_name = excluded.display_name
    returning id into v_id;
  return v_id;
end;
$$;

-- First authenticated user can claim commissioner rights if none exist yet.
create or replace function claim_contest_admin(p_contest uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if exists (select 1 from contest_admins where contest_id = p_contest) then
    return is_contest_admin(p_contest);
  end if;
  insert into contest_admins (contest_id, user_id) values (p_contest, auth.uid());
  return true;
end;
$$;

-- Submit the 4 group-stage picks (replaces any existing group picks).
create or replace function submit_group_picks(p_entry uuid, p_teams text[])
returns void language plpgsql security definer set search_path = public as $$
declare v_contest uuid; t text;
begin
  if (select user_id from entries where id = p_entry) is distinct from auth.uid() then
    raise exception 'Not your entry';
  end if;
  if array_length(p_teams,1) is distinct from 4 then raise exception 'Select exactly 4 teams'; end if;
  if (select count(distinct x) from unnest(p_teams) x) <> 4 then raise exception 'Teams must be unique'; end if;
  select contest_id into v_contest from entries where id = p_entry;

  delete from picks where entry_id = p_entry and round_key = 'GROUP';
  foreach t in array p_teams loop
    insert into picks (entry_id, round_key, team_id) values (p_entry, 'GROUP', t);
  end loop;
end;
$$;

-- Submit / change a single knockout pick (replaces any existing pick for that round).
create or replace function submit_ko_pick(p_entry uuid, p_round text, p_team text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if (select user_id from entries where id = p_entry) is distinct from auth.uid() then
    raise exception 'Not your entry';
  end if;
  if p_round = 'GROUP' then raise exception 'Use submit_group_picks for the group stage'; end if;
  delete from picks where entry_id = p_entry and round_key = p_round;
  insert into picks (entry_id, round_key, team_id) values (p_entry, p_round, p_team);
end;
$$;

-- Commissioner: set a round's lifecycle status.
create or replace function set_round_status(p_contest uuid, p_round text, p_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_contest_admin(p_contest) then raise exception 'Admin only'; end if;
  if p_status not in ('upcoming','open','locked','resolved') then raise exception 'Bad status'; end if;
  update rounds set status = p_status where contest_id = p_contest and key = p_round;
end;
$$;

-- Commissioner: set / clear a round's lock deadline.
create or replace function set_round_lock(p_contest uuid, p_round text, p_lock_at timestamptz)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_contest_admin(p_contest) then raise exception 'Admin only'; end if;
  update rounds set lock_at = p_lock_at where contest_id = p_contest and key = p_round;
end;
$$;

-- Commissioner override: declare the teams that advanced FROM a round, mark it
-- resolved, and open the next round. This is also what the sync function calls
-- (via service role, which bypasses the admin check).
create or replace function resolve_round(p_contest uuid, p_round text, p_advancers text[])
returns void language plpgsql security definer set search_path = public as $$
declare v_next text; v_sort int; t text;
begin
  if not is_contest_admin(p_contest) then raise exception 'Admin only'; end if;

  delete from round_advancers where contest_id = p_contest and round_key = p_round;
  if p_advancers is not null then
    foreach t in array p_advancers loop
      insert into round_advancers (contest_id, round_key, team_id) values (p_contest, p_round, t)
        on conflict do nothing;
    end loop;
  end if;

  update rounds set status = 'resolved' where contest_id = p_contest and key = p_round;

  -- open the next round automatically
  select sort into v_sort from rounds where contest_id = p_contest and key = p_round;
  select key into v_next from rounds where contest_id = p_contest and sort = v_sort + 1;
  if v_next is not null then
    update rounds set status = 'open'
      where contest_id = p_contest and key = v_next and status = 'upcoming';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table contests        enable row level security;
alter table contest_admins  enable row level security;
alter table rounds          enable row level security;
alter table round_advancers enable row level security;
alter table matches         enable row level security;
alter table entries         enable row level security;
alter table picks           enable row level security;
alter table teams           enable row level security;

-- teams / contests / rounds / advancers / matches are public-readable
drop policy if exists teams_read on teams;
create policy teams_read on teams for select using (true);

drop policy if exists contests_read on contests;
create policy contests_read on contests for select using (true);

drop policy if exists rounds_read on rounds;
create policy rounds_read on rounds for select using (true);

drop policy if exists advancers_read on round_advancers;
create policy advancers_read on round_advancers for select using (true);

drop policy if exists matches_read on matches;
create policy matches_read on matches for select using (true);

drop policy if exists admins_read on contest_admins;
create policy admins_read on contest_admins for select using (true);

-- entries: anyone may read (standings); users insert/update only their own
drop policy if exists entries_read on entries;
create policy entries_read on entries for select using (true);
drop policy if exists entries_insert on entries;
create policy entries_insert on entries for insert with check (user_id = auth.uid());
drop policy if exists entries_update on entries;
create policy entries_update on entries for update using (user_id = auth.uid());

-- picks: you can always see your own; everyone else's only AFTER the round locks
drop policy if exists picks_read on picks;
create policy picks_read on picks for select using (
  exists (select 1 from entries e where e.id = picks.entry_id and e.user_id = auth.uid())
  or exists (
    select 1 from entries e
    where e.id = picks.entry_id and round_locked(e.contest_id, picks.round_key)
  )
);
-- direct writes allowed only on your own entry while the round is open & unlocked
-- (the RPCs above are the normal path; these policies back them up)
drop policy if exists picks_write on picks;
create policy picks_write on picks for insert with check (
  exists (
    select 1 from entries e join rounds r
      on r.contest_id = e.contest_id and r.key = picks.round_key
    where e.id = picks.entry_id and e.user_id = auth.uid()
      and r.status = 'open' and (r.lock_at is null or now() < r.lock_at)
  )
);
drop policy if exists picks_delete on picks;
create policy picks_delete on picks for delete using (
  exists (
    select 1 from entries e join rounds r
      on r.contest_id = e.contest_id and r.key = picks.round_key
    where e.id = picks.entry_id and e.user_id = auth.uid()
      and r.status = 'open' and (r.lock_at is null or now() < r.lock_at)
  )
);

-- ---------------------------------------------------------------------------
-- Grants (PostgREST/anon + authenticated). RLS above still gates every row.
-- ---------------------------------------------------------------------------
grant usage on schema public to anon, authenticated;
grant select on teams, contests, rounds, round_advancers, matches,
                entries, picks, contest_admins, v_entry_status
  to anon, authenticated;
grant insert, update on entries to authenticated;
grant insert, delete on picks   to authenticated;
grant execute on function
  join_contest(uuid, text), claim_contest_admin(uuid),
  submit_group_picks(uuid, text[]), submit_ko_pick(uuid, text, text),
  set_round_status(uuid, text, text), set_round_lock(uuid, text, timestamptz),
  resolve_round(uuid, text, text[])
  to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime: broadcast changes so the UI updates live for everyone.
-- ---------------------------------------------------------------------------
do $$
begin
  begin alter publication supabase_realtime add table rounds; exception when others then null; end;
  begin alter publication supabase_realtime add table round_advancers; exception when others then null; end;
  begin alter publication supabase_realtime add table entries; exception when others then null; end;
  begin alter publication supabase_realtime add table picks; exception when others then null; end;
end $$;
