-- Lock search_path on the two SECURITY INVOKER trigger helpers.
--
-- The original schema migration set `set search_path = ''` only on the
-- SECURITY DEFINER function `bump_application_last_action_at`. The two
-- plpgsql trigger functions it omits don't reference any table by name
-- today (one only writes NEW.last_action_at; the other PERFORMs a fully
-- qualified function), so there's nothing to hijack right now. Locking
-- search_path here is defense-in-depth: if a future edit ever adds an
-- unqualified `update applications ...` it won't silently route to a
-- shadowed table. Also clears Supabase's `function_search_path_mutable`
-- linter warnings, which the Phase 1 success criterion (clean db lint)
-- implicitly relied on.
--
-- `create or replace function` keeps existing triggers attached.

create or replace function public.applications_bump_last_action_at_on_status_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.last_action_at = now();
  return new;
end;
$$;

create or replace function public.application_notes_bump_parent_trigger()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform public.bump_application_last_action_at(new.application_id);
  return null;
end;
$$;
