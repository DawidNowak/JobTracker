import type { WorkMode } from "@/lib/validation/applications";
import type { ParseResult } from "./types";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function sniffWorkMode(haystack: string): WorkMode | undefined {
  const h = haystack.toLowerCase();
  if (/\b(zdaln|remote)/.test(h)) return "Zdalna";
  if (/\b(hybrydow|hybrid)/.test(h)) return "Hybrydowa";
  if (/\b(stacjonarn|on[-\s]?site|onsite)/.test(h)) return "Stacjonarna";
  return undefined;
}

export async function parseLinkedIn(jobId: string): Promise<ParseResult> {
  const url = `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${encodeURIComponent(jobId)}`;
  const response = await fetch(url, {
    signal: AbortSignal.timeout(8000),
    headers: {
      "User-Agent": USER_AGENT,
      "Accept-Language": "en-US,en;q=0.9,pl;q=0.8",
    },
  });
  if (response.status !== 200) {
    throw new Error(`LinkedIn non-200 status: ${response.status}`);
  }

  let titleBuf = "";
  let companyBuf = "";
  let locationBuf = "";
  let descriptionBuf = "";
  let salaryBuf = "";

  const rewritten = new HTMLRewriter()
    .on(".top-card-layout__title, .topcard__title", {
      text(t) {
        titleBuf += t.text;
      },
    })
    .on(".topcard__org-name-link, .topcard__flavor", {
      text(t) {
        if (companyBuf.trim().length === 0) companyBuf += t.text;
      },
    })
    .on(".topcard__flavor.topcard__flavor--bullet", {
      text(t) {
        if (locationBuf.trim().length === 0) locationBuf += t.text;
      },
    })
    .on(".show-more-less-html__markup, .description__text", {
      text(t) {
        descriptionBuf += t.text;
      },
    })
    .on(".compensation__salary", {
      text(t) {
        salaryBuf += t.text;
      },
    })
    .transform(response);
  await rewritten.text();

  const position = titleBuf.trim();
  if (position.length === 0) {
    throw new Error("LinkedIn topcard empty");
  }

  const result: ParseResult = { position };
  const company = companyBuf.trim();
  if (company.length > 0) result.company = company;
  const description = descriptionBuf.trim();
  if (description.length > 0) result.description = description;
  const salary = salaryBuf.trim();
  if (salary.length > 0) result.salary = salary;

  const location = locationBuf.trim();
  const haystack = `${position} ${location} ${description.slice(0, 2048)}`;
  const workMode = sniffWorkMode(haystack);
  if (workMode) result.work_mode = workMode;

  return result;
}
