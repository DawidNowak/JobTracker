import { z } from "zod";

export const applicationStatusValues = ["Interesujące", "Zaaplikowano", "Rozmowa"] as const;
export const workModeValues = ["Zdalna", "Hybrydowa", "Stacjonarna"] as const;

export const applicationStatusSchema = z.enum(applicationStatusValues);
export const workModeSchema = z.enum(workModeValues);

export type ApplicationStatus = z.infer<typeof applicationStatusSchema>;
export type WorkMode = z.infer<typeof workModeSchema>;

export const applicationCreateSchema = z.object({
  source: z.string().min(1),
  position: z.string().nullable().optional(),
  company: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  salary: z.string().nullable().optional(),
  work_mode: workModeSchema.nullable().optional(),
  recruiter_contact: z.string().nullable().optional(),
  status: applicationStatusSchema.default("Interesujące"),
});

export const applicationUpdateSchema = z
  .object({
    source: z.string().min(1).optional(),
    position: z.string().nullable().optional(),
    company: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    salary: z.string().nullable().optional(),
    work_mode: workModeSchema.nullable().optional(),
    recruiter_contact: z.string().nullable().optional(),
    status: applicationStatusSchema.optional(),
  })
  .refine((obj) => Object.keys(obj).length > 0, {
    message: "Brak pól do aktualizacji.",
  });

export const applicationStatusUpdateSchema = z.object({
  status: applicationStatusSchema,
});

// Notes carry `application_id` / `noteId` in the URL, so the request body is
// just `{ body }`. One schema covers both create (POST) and edit (PATCH).
export const applicationNoteBodySchema = z.object({ body: z.string().min(1) });

export const applicationParseSchema = z.object({
  source: z.string().min(1),
});

export type ApplicationCreate = z.infer<typeof applicationCreateSchema>;
export type ApplicationUpdate = z.infer<typeof applicationUpdateSchema>;
export type ApplicationStatusUpdate = z.infer<typeof applicationStatusUpdateSchema>;
export type ApplicationNoteBody = z.infer<typeof applicationNoteBodySchema>;
export type ApplicationParse = z.infer<typeof applicationParseSchema>;
