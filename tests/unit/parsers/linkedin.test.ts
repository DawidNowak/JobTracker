import { describe, it, expect } from "vitest";
import { parseLinkedIn } from "@/lib/parsers/linkedin";
import { withFetchStub } from "../../helpers/fetch";

// Fixtures are captured HTML responses from the LinkedIn guest job API.
// happy.html  — SYNTHETIC fixture modelled on real LinkedIn guest-API HTML.
//               Captures all 5 ParseResult fields (position, company, description, salary,
//               work_mode). Oracle values derived from the HTML content directly.
//               Source: synthetic (see tests/fixtures/parsers/README.md), capture date 2026-06-18.
// missing-salary.html — REAL LinkedIn guest API response.
//               Source: https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/4190845636
//               Captured: 2026-06-18. Position: "Auxiliar de Recursos Humanos", Company: "EDs RH".
//               Salary is genuinely absent; all other expected fields present.
// corrupted.html — happy.html with the `topcard__title` CSS class removed,
//               so position extraction fails and the parser throws.

import happyHtml from "../../fixtures/parsers/linkedin/happy.html?raw";
import missingSalaryHtml from "../../fixtures/parsers/linkedin/missing-salary.html?raw";
import corruptedHtml from "../../fixtures/parsers/linkedin/corrupted.html?raw";

const FAKE_JOB_ID = "12345678";

describe("parseLinkedIn — fixture suite", () => {
  it("happy: extracts all five fields from a complete posting", async () => {
    await withFetchStub(
      () => new Response(happyHtml, { status: 200 }),
      async () => {
        const result = await parseLinkedIn(FAKE_JOB_ID);

        // Oracle values read directly from happy.html — not derived by running the parser.
        expect(result.position).toBe("Senior Software Engineer");
        expect(result.company).toBe("Acme Corp");
        expect(result.salary).toBe("$120,000/yr - $150,000/yr");
        expect(result.work_mode).toBe("Zdalna");
        expect(result.description).toContain(
          "We are looking for a Senior Software Engineer to join our remote-first team",
        );
        expect(result.description).toContain("5+ years of experience in software engineering");
      },
    );
  });

  it("missing-salary: salary is undefined, required fields still present", async () => {
    await withFetchStub(
      () => new Response(missingSalaryHtml, { status: 200 }),
      async () => {
        const result = await parseLinkedIn(FAKE_JOB_ID);

        // Oracle values from LinkedIn job ID 4190845636 (captured 2026-06-18).
        expect(result.position).toBe("Auxiliar de Recursos Humanos");
        expect(result.company).toBe("EDs RH");
        expect(result.salary).toBeUndefined();
        expect(result.work_mode).toBeUndefined();
        expect(result.description).toContain("Estamos em busca de um profissional");
      },
    );
  });

  it("corrupted: parser throws when .topcard__title is absent", async () => {
    await withFetchStub(
      () => new Response(corruptedHtml, { status: 200 }),
      async () => {
        await expect(parseLinkedIn(FAKE_JOB_ID)).rejects.toThrow();
      },
    );
  });
});
