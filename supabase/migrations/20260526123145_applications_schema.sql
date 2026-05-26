-- F-01: Applications schema with per-user RLS and DB-enforced last_action_at semantics.
--
-- Two tables: public.applications and public.application_notes.
-- Every row is scoped to auth.uid() via RLS (SELECT/INSERT/UPDATE/DELETE policies).
-- last_action_at advances only on (a) status change via BEFORE UPDATE trigger,
-- or (b) note insert via AFTER INSERT trigger calling a SECURITY DEFINER function.
-- Polish literals in CHECK constraints are stored verbatim so UI is a passthrough.

-- ----------------------------------------------------------------------------
-- applications
-- ----------------------------------------------------------------------------

create table public.applications (
  id                 uuid        primary key default gen_random_uuid(),
  user_id            uuid        not null references auth.users(id) on delete cascade,
  source             text        not null,
  position           text,
  company            text,
  description        text,
  salary             text,
  work_mode          text        check (work_mode is null or work_mode in ('Zdalna', 'Hybrydowa', 'Stacjonarna')),
  recruiter_contact  text,
  status             text        not null default 'Interesujące'
                                 check (status in ('Interesujące', 'Zaaplikowano', 'Rozmowa')),
  created_at         timestamptz not null default now(),
  last_action_at     timestamptz not null default now(),
  archived_at        timestamptz
);

create index applications_user_id_idx on public.applications (user_id);

create index applications_active_board_idx
  on public.applications (user_id, status)
  where archived_at is null;

create index applications_archive_idx
  on public.applications (user_id, archived_at)
  where archived_at is not null;

alter table public.applications enable row level security;

create policy applications_select_own
  on public.applications for select
  to authenticated
  using (user_id = auth.uid());

create policy applications_insert_own
  on public.applications for insert
  to authenticated
  with check (user_id = auth.uid());

create policy applications_update_own
  on public.applications for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy applications_delete_own
  on public.applications for delete
  to authenticated
  using (user_id = auth.uid());

-- ----------------------------------------------------------------------------
-- application_notes
-- ----------------------------------------------------------------------------

create table public.application_notes (
  id              uuid        primary key default gen_random_uuid(),
  application_id  uuid        not null references public.applications(id) on delete cascade,
  user_id         uuid        not null references auth.users(id) on delete cascade,
  body            text        not null check (length(body) > 0),
  created_at      timestamptz not null default now()
);

create index application_notes_history_idx
  on public.application_notes (application_id, created_at desc);

alter table public.application_notes enable row level security;

create policy application_notes_select_own
  on public.application_notes for select
  to authenticated
  using (user_id = auth.uid());

create policy application_notes_insert_own
  on public.application_notes for insert
  to authenticated
  with check (user_id = auth.uid());

create policy application_notes_update_own
  on public.application_notes for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy application_notes_delete_own
  on public.application_notes for delete
  to authenticated
  using (user_id = auth.uid());

-- ----------------------------------------------------------------------------
-- last_action_at enforcement
-- ----------------------------------------------------------------------------

-- BEFORE UPDATE on applications: bump last_action_at when status changes.
-- Edits to other columns (position, company, description, salary, work_mode,
-- recruiter_contact, source) leave last_action_at untouched.
create or replace function public.applications_bump_last_action_at_on_status_change()
returns trigger
language plpgsql
as $$
begin
  new.last_action_at = now();
  return new;
end;
$$;

create trigger applications_status_bumps_last_action
  before update on public.applications
  for each row
  when (old.status is distinct from new.status)
  execute function public.applications_bump_last_action_at_on_status_change();

-- AFTER INSERT on application_notes: bump parent application's last_action_at.
-- SECURITY DEFINER bypasses applications RLS for the internal UPDATE. The note
-- insert itself is still RLS-gated on application_notes.user_id, so a user
-- cannot insert a note that points at another user's application.
create or replace function public.bump_application_last_action_at(app_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.applications
     set last_action_at = now()
   where id = app_id;
end;
$$;

revoke all on function public.bump_application_last_action_at(uuid) from public;
grant execute on function public.bump_application_last_action_at(uuid) to authenticated;

create or replace function public.application_notes_bump_parent_trigger()
returns trigger
language plpgsql
as $$
begin
  perform public.bump_application_last_action_at(new.application_id);
  return null;
end;
$$;

create trigger application_notes_bumps_parent_last_action
  after insert on public.application_notes
  for each row
  execute function public.application_notes_bump_parent_trigger();
