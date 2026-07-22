---
change_id: auth-page-rework
title: Auth page rework
status: archived
created: 2026-07-21
updated: 2026-07-22
archived_at: 2026-07-22T07:47:59Z
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

- Residual (confirmed out of scope during Phase 2 manual verification): auth API server-error
  messages (e.g. Supabase's "User already registered" in `src/pages/api/auth/signup.ts`,
  and the hardcoded "Supabase is not configured") are still English. Translating them requires
  mapping Supabase error messages/codes to Polish in `src/pages/api/auth/{signin,signup}.ts` —
  tracked as a separate follow-up change, not part of `auth-page-rework`.
