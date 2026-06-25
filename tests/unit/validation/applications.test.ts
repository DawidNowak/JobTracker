import { describe, it, expect } from "vitest";
import {
  applicationStatusSchema,
  workModeSchema,
  applicationCreateSchema,
  applicationUpdateSchema,
  applicationStatusUpdateSchema,
  applicationNoteCreateSchema,
  applicationParseSchema,
} from "@/lib/validation/applications";

describe("applicationStatusSchema", () => {
  it.each(["Interesujące", "Zaaplikowano", "Rozmowa"])("accepts active kanban status '%s'", (status) => {
    expect(applicationStatusSchema.safeParse(status).success).toBe(true);
  });

  it("rejects 'Odrzucony' — rejected apps are archived, not an active kanban column", () => {
    expect(applicationStatusSchema.safeParse("Odrzucony").success).toBe(false);
  });

  it.each(["", "rejected", "rozmowa", "ROZMOWA"])("rejects non-status value '%s'", (val) => {
    expect(applicationStatusSchema.safeParse(val).success).toBe(false);
  });
});

describe("workModeSchema", () => {
  it.each(["Zdalna", "Hybrydowa", "Stacjonarna"])("accepts valid work mode '%s'", (mode) => {
    expect(workModeSchema.safeParse(mode).success).toBe(true);
  });

  it.each(["Remote", "hybrid", "", "zdalna", "On-site"])("rejects invalid work mode '%s'", (mode) => {
    expect(workModeSchema.safeParse(mode).success).toBe(false);
  });
});

describe("applicationCreateSchema", () => {
  describe("source field (required free text — FR-003)", () => {
    it("accepts any non-empty string (free text, no URL validation)", () => {
      expect(applicationCreateSchema.safeParse({ source: "via recruiter call" }).success).toBe(true);
    });

    it("rejects empty source", () => {
      expect(applicationCreateSchema.safeParse({ source: "" }).success).toBe(false);
    });

    it("rejects missing source", () => {
      expect(applicationCreateSchema.safeParse({ position: "Developer" }).success).toBe(false);
    });
  });

  describe("status default", () => {
    it("defaults to 'Interesujące' when status is omitted", () => {
      const result = applicationCreateSchema.safeParse({ source: "any" });
      expect(result.success && result.data.status).toBe("Interesujące");
    });
  });

  describe("optional fields", () => {
    it("accepts minimal input with only source", () => {
      expect(applicationCreateSchema.safeParse({ source: "x" }).success).toBe(true);
    });

    it("accepts all optional fields set to null", () => {
      expect(
        applicationCreateSchema.safeParse({
          source: "x",
          position: null,
          company: null,
          description: null,
          salary: null,
          work_mode: null,
          recruiter_contact: null,
        }).success,
      ).toBe(true);
    });

    it("accepts fully-populated valid input", () => {
      expect(
        applicationCreateSchema.safeParse({
          source: "https://justjoin.it/offers/123",
          position: "Senior Developer",
          company: "ACME",
          description: "Great role",
          salary: "15 000–20 000 PLN",
          work_mode: "Hybrydowa",
          recruiter_contact: "recruiter@acme.com",
          status: "Zaaplikowano",
        }).success,
      ).toBe(true);
    });

    it("rejects invalid work_mode", () => {
      expect(applicationCreateSchema.safeParse({ source: "x", work_mode: "Remote" }).success).toBe(false);
    });

    it("rejects invalid status (e.g. archived state 'Odrzucony')", () => {
      expect(applicationCreateSchema.safeParse({ source: "x", status: "Odrzucony" }).success).toBe(false);
    });
  });
});

describe("applicationUpdateSchema", () => {
  it("rejects empty object — at least one field must be provided", () => {
    expect(applicationUpdateSchema.safeParse({}).success).toBe(false);
  });

  it("accepts update with only source", () => {
    expect(applicationUpdateSchema.safeParse({ source: "corrected source" }).success).toBe(true);
  });

  it("rejects source updated to empty string — cannot erase the source", () => {
    expect(applicationUpdateSchema.safeParse({ source: "" }).success).toBe(false);
  });

  it("accepts update with only status", () => {
    expect(applicationUpdateSchema.safeParse({ status: "Rozmowa" }).success).toBe(true);
  });

  it("rejects invalid status in update", () => {
    expect(applicationUpdateSchema.safeParse({ status: "Odrzucony" }).success).toBe(false);
  });

  it("accepts nullable optional fields (clearing them)", () => {
    expect(applicationUpdateSchema.safeParse({ company: null, salary: null }).success).toBe(true);
  });

  it("rejects invalid work_mode in update", () => {
    expect(applicationUpdateSchema.safeParse({ work_mode: "Remote" }).success).toBe(false);
  });
});

describe("applicationStatusUpdateSchema", () => {
  it.each(["Interesujące", "Zaaplikowano", "Rozmowa"])("accepts valid status '%s'", (status) => {
    expect(applicationStatusUpdateSchema.safeParse({ status }).success).toBe(true);
  });

  it("rejects missing status", () => {
    expect(applicationStatusUpdateSchema.safeParse({}).success).toBe(false);
  });

  it("rejects invalid status 'Odrzucony'", () => {
    expect(applicationStatusUpdateSchema.safeParse({ status: "Odrzucony" }).success).toBe(false);
  });
});

describe("applicationNoteCreateSchema", () => {
  const VALID_UUID = "550e8400-e29b-41d4-a716-446655440000";

  it("accepts a valid UUID and non-empty body", () => {
    expect(
      applicationNoteCreateSchema.safeParse({ application_id: VALID_UUID, body: "Follow-up sent to recruiter." }).success,
    ).toBe(true);
  });

  it("rejects empty body — notes must contain content", () => {
    expect(applicationNoteCreateSchema.safeParse({ application_id: VALID_UUID, body: "" }).success).toBe(false);
  });

  it("rejects missing body", () => {
    expect(applicationNoteCreateSchema.safeParse({ application_id: VALID_UUID }).success).toBe(false);
  });

  it("rejects non-UUID application_id", () => {
    expect(applicationNoteCreateSchema.safeParse({ application_id: "not-a-uuid", body: "note" }).success).toBe(false);
  });

  it("rejects missing application_id", () => {
    expect(applicationNoteCreateSchema.safeParse({ body: "note" }).success).toBe(false);
  });
});

describe("applicationParseSchema", () => {
  it("accepts a non-empty source (activates parser button when URL — FR-004)", () => {
    expect(applicationParseSchema.safeParse({ source: "https://linkedin.com/jobs/123" }).success).toBe(true);
  });

  it("rejects empty source", () => {
    expect(applicationParseSchema.safeParse({ source: "" }).success).toBe(false);
  });

  it("rejects missing source", () => {
    expect(applicationParseSchema.safeParse({}).success).toBe(false);
  });
});
