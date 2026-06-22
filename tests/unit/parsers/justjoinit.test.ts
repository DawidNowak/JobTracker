import { describe, it, expect } from "vitest";
import { parseJustJoinIT } from "@/lib/parsers/justjoinit";
import { withFetchStub } from "../../helpers/fetch";

// Fixtures are full Next.js page HTML responses from justjoin.it.
// happy.html      — REAL page for slug `clurgo-senior-full-stack-engineer-node-js-angular-react--poland-remote--javascript`.
//                   Captured 2026-06-18. Job: "Senior Full Stack Engineer (Node.js + Angular/React)" at Clurgo.
//                   Source URL: https://justjoin.it/job-offer/clurgo-senior-full-stack-engineer-node-js-angular-react--poland-remote--javascript
//                   All 5 ParseResult fields present (salary in 5 currencies, work_mode=remote).
// missing-salary.html — REAL page for slug `from-poland-with-dev-business-development-lead-research-intern-sharetheboard-bielsko-biala-ai`.
//                   Captured 2026-06-18. Job: "Business Development & Lead Research Intern | ShareTheBoard" at From Poland With Dev.
//                   Source URL: https://justjoin.it/job-offer/from-poland-with-dev-business-development-lead-research-intern-sharetheboard-bielsko-biala-ai
//                   Salary genuinely absent (internship with all employmentTypes from=null).
// corrupted.html  — happy.html with every occurrence of `workplaceType` replaced by `_workplaceTypeX`,
//                   so extractOfferObject cannot locate the offer marker and throws.

import happyHtml from "../../fixtures/parsers/justjoinit/happy.html?raw";
import missingSalaryHtml from "../../fixtures/parsers/justjoinit/missing-salary.html?raw";
import corruptedHtml from "../../fixtures/parsers/justjoinit/corrupted.html?raw";

const FAKE_SLUG = "test-slug-123";

describe("parseJustJoinIT — fixture suite", () => {
  it("happy: extracts all five fields from a complete posting", async () => {
    await withFetchStub(
      () => new Response(happyHtml, { status: 200 }),
      async () => {
        const result = await parseJustJoinIT(FAKE_SLUG);

        // Oracle values read from justjoin.it page at capture time (2026-06-18).
        // Salary: 5 currencies (EUR, CHF, USD, GBP, PLN) × B2B × /hour; all rounded.
        expect(result.position).toBe("Senior Full Stack Engineer (Node.js + Angular/React)");
        expect(result.company).toBe("Clurgo");
        expect(result.work_mode).toBe("Zdalna");
        expect(result.salary).toBe(
          "28 – 35 EUR/hour (B2B); 26 – 33 CHF/hour (B2B); 33 – 41 USD/hour (B2B); 24 – 31 GBP/hour (B2B); 120 – 150 PLN/hour (B2B)",
        );
        // Description is prefixed with required skills, then the body HTML.
        expect(result.description).toMatch(/^Wymagane umiej[eę]tno[sś]ci: JavaScript/);
        expect(result.description).toContain("React");
        expect(result.description).toContain("Clurgo to firma stworzona przez developer");
      },
    );
  });

  it("missing-salary: salary is undefined, required fields still present", async () => {
    await withFetchStub(
      () => new Response(missingSalaryHtml, { status: 200 }),
      async () => {
        const result = await parseJustJoinIT(FAKE_SLUG);

        // Oracle values from justjoin.it capture (2026-06-18). Internship with no salary range.
        expect(result.position).toBe("Business Development & Lead Research Intern | ShareTheBoard");
        expect(result.company).toBe("From Poland With Dev");
        expect(result.work_mode).toBe("Zdalna");
        expect(result.salary).toBeUndefined();
        expect(result.description).toMatch(/^Wymagane umiej[eę]tno[sś]ci: Business Development/);
      },
    );
  });

  it("corrupted: parser throws when workplaceType marker is absent", async () => {
    await withFetchStub(
      () => new Response(corruptedHtml, { status: 200 }),
      async () => {
        await expect(parseJustJoinIT(FAKE_SLUG)).rejects.toThrow();
      },
    );
  });
});
