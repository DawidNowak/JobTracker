-- Harden application_notes RLS: prevent cross-user note inserts.
--
-- The original INSERT policy only checked `user_id = auth.uid()`. User B could
-- satisfy this by setting user_id to their own UID while pointing application_id
-- at User A's application — RLS let it through because the self-assertion was
-- valid in isolation. The note ended up "owned" by User B but attached to
-- User A's application, leaking write capability across the user boundary.
--
-- Fix: strengthen INSERT and UPDATE policies to also EXISTS-check that the
-- referenced application belongs to auth.uid(). SELECT and DELETE keep the
-- direct-equality form since they read/delete a note already scoped by its
-- own user_id, which the writer-side check now guarantees is consistent with
-- the parent application's ownership.

drop policy application_notes_insert_own on public.application_notes;

create policy application_notes_insert_own
  on public.application_notes for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1
        from public.applications
       where id = application_id
         and user_id = auth.uid()
    )
  );

drop policy application_notes_update_own on public.application_notes;

create policy application_notes_update_own
  on public.application_notes for update
  to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (
      select 1
        from public.applications
       where id = application_id
         and user_id = auth.uid()
    )
  );
