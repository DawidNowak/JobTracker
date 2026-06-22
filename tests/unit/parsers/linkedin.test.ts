import { describe, it, expect, vi } from "vitest";
import { parseLinkedIn } from "@/lib/parsers/linkedin";
import { withFetchStub } from "../../helpers/fetch";

// Fixtures are captured HTML responses from the LinkedIn guest job API.
// happy.html  — REAL LinkedIn guest API response.
//               Source: https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/4422277574
//               (visible page: linkedin.com/jobs/collections/recommended/?currentJobId=4422277574)
//               Captured: 2026-06-22. Position: "Senior .Net Developer", Company:
//               "Tata Consultancy Services". Salary is absent (LinkedIn's guest API exposes
//               salary only for US pay-transparency postings); position/company/description/
//               work_mode are all present. Oracle values hand-read from the visible page.
// salary-synthetic.html — SYNTHETIC fixture. LinkedIn guest HTML almost never renders the
//               `.compensation__salary` block, so a real fixture cannot exercise the salary
//               extraction path. This minimal hand-authored payload covers that one selector
//               only; treat its assertions as a selector contract, not real-HTML coverage.
//               Source: synthetic (see tests/fixtures/parsers/README.md), authored 2026-06-18.
// missing-salary.html — REAL LinkedIn guest API response.
//               Source: https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/4190845636
//               Captured: 2026-06-18. Position: "Auxiliar de Recursos Humanos", Company: "EDs RH".
//               Salary is genuinely absent; work_mode also absent.
// corrupted.html — happy.html with both title selector classes removed,
//               so position extraction fails and the parser throws.

import happyHtml from "../../fixtures/parsers/linkedin/happy.html?raw";
import salarySyntheticHtml from "../../fixtures/parsers/linkedin/salary-synthetic.html?raw";
import missingSalaryHtml from "../../fixtures/parsers/linkedin/missing-salary.html?raw";
import corruptedHtml from "../../fixtures/parsers/linkedin/corrupted.html?raw";

const FAKE_JOB_ID = "12345678";

describe("parseLinkedIn — fixture suite", () => {
  it("happy: extracts position, company, work_mode, and description from a real posting", async () => {
    await withFetchStub(
      () => new Response(happyHtml, { status: 200 }),
      async () => {
        const result = await parseLinkedIn(FAKE_JOB_ID);

        // Oracle values hand-read from the visible LinkedIn page (jobId 4422277574,
        // captured 2026-06-22) — not derived by running the parser.
        expect(result.position).toBe("Senior .Net Developer");
        expect(result.company).toBe("Tata Consultancy Services");
        // The visible posting states a "Hybrid working model (2 days office, 3 days remote)".
        expect(result.work_mode).toBe("Hybrydowa");
        // Salary is not exposed in LinkedIn's guest API for this posting.
        expect(result.salary).toBeUndefined();
        expect(result.description).toContain("Develop and maintain applications using .NET Framework");
        expect(result.description).toContain("Hybrid working");
      },
    );
  });

  it("salary-synthetic: extracts the .compensation__salary block (selector contract)", async () => {
    await withFetchStub(
      () => new Response(salarySyntheticHtml, { status: 200 }),
      async () => {
        const result = await parseLinkedIn(FAKE_JOB_ID);

        // Synthetic fixture — covers the salary selector that real guest HTML rarely renders.
        expect(result.salary).toBe("$120,000/yr - $150,000/yr");
        expect(result.position).toBe("Senior Software Engineer");
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

  it("corrupted: parser throws when title selector classes are absent", async () => {
    await withFetchStub(
      () => new Response(corruptedHtml, { status: 200 }),
      async () => {
        await expect(parseLinkedIn(FAKE_JOB_ID)).rejects.toThrow();
      },
    );
  });
});

describe("parseLinkedIn — hardening regressions", () => {
  it("redirect: parser throws on an opaque redirect and sends redirect:manual in fetch options", async () => {
    let capturedRedirect: string | undefined;
    // workerd returns an opaque-redirect filtered response (type "opaqueredirect", status 0)
    // for an upstream 3xx when redirect: "manual" is set — Response cannot be constructed with
    // status 0, so model that shape directly.
    const opaqueRedirect = { type: "opaqueredirect", status: 0 } as unknown as Response;
    vi.stubGlobal("fetch", (_: unknown, init?: { redirect?: string }) => {
      capturedRedirect = init?.redirect;
      return Promise.resolve(opaqueRedirect);
    });
    try {
      await expect(parseLinkedIn(FAKE_JOB_ID)).rejects.toThrow();
    } finally {
      vi.unstubAllGlobals();
    }
    expect(capturedRedirect).toBe("manual");
  });

  it("input re-check: throws before calling fetch for invalid jobId", async () => {
    let fetchCalled = false;
    await withFetchStub(
      () => {
        fetchCalled = true;
        return new Response("", { status: 200 });
      },
      async () => {
        await expect(parseLinkedIn("not-a-jobid")).rejects.toThrow();
      },
    );
    expect(fetchCalled).toBe(false);
  });

  it("buffer cap: throws when accumulated buffers exceed the size limit", async () => {
    // A title is present (so the parser does not fail earlier on an empty topcard),
    // but the description is larger than MAX_BUFFER_CHARS (4_000_000).
    const huge = "x".repeat(4_000_001);
    const html = `<h2 class="topcard__title">T</h2><div class="show-more-less-html__markup"><p>${huge}</p></div>`;
    await withFetchStub(
      () => new Response(html, { status: 200 }),
      async () => {
        await expect(parseLinkedIn(FAKE_JOB_ID)).rejects.toThrow(/too large/);
      },
    );
  });
});
