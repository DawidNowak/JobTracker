-- Drop the plain (user_id) index on applications.
--
-- It's covered for every read pattern F-01 supports today by the two
-- partial indexes:
--   applications_active_board_idx  (user_id, status) WHERE archived_at IS NULL
--   applications_archive_idx       (user_id, archived_at) WHERE archived_at IS NOT NULL
--
-- Any future "all rows for this user, regardless of archive state" query
-- can re-add it (cheap) once the access pattern actually appears.

drop index if exists public.applications_user_id_idx;
