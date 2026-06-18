import { describe, it, expect } from "vitest";
import { recognize, type RecognizedSource } from "@/lib/parsers/recognize";

const table: { desc: string; input: string; expected: RecognizedSource | null }[] = [
  // ── LinkedIn positive ──────────────────────────────────────────────────────
  {
    desc: "www.linkedin.com path jobId",
    input: "https://www.linkedin.com/jobs/view/123456789/",
    expected: { kind: "linkedin", jobId: "123456789" },
  },
  {
    desc: "linkedin.com (bare) path jobId",
    input: "https://linkedin.com/jobs/view/123456789/",
    expected: { kind: "linkedin", jobId: "123456789" },
  },
  {
    desc: "pl.linkedin.com path jobId",
    input: "https://pl.linkedin.com/jobs/view/123456789/",
    expected: { kind: "linkedin", jobId: "123456789" },
  },
  {
    desc: "www.linkedin.com currentJobId query param",
    input: "https://www.linkedin.com/jobs/search/?currentJobId=123456789",
    expected: { kind: "linkedin", jobId: "123456789" },
  },
  {
    desc: "mixed-case host normalises to allowed host",
    input: "https://WWW.LINKEDIN.COM/jobs/view/123456789/",
    expected: { kind: "linkedin", jobId: "123456789" },
  },
  {
    desc: "http: protocol is accepted by recognize()",
    input: "http://www.linkedin.com/jobs/view/123456789/",
    expected: { kind: "linkedin", jobId: "123456789" },
  },

  // ── JJIT positive ─────────────────────────────────────────────────────────
  {
    desc: "justjoin.it slug (basic)",
    input: "https://justjoin.it/job-offer/senior-react-developer",
    expected: { kind: "jjit", slug: "senior-react-developer" },
  },
  {
    desc: "justjoin.it slug with trailing slash",
    input: "https://justjoin.it/job-offer/devops-engineer-123/",
    expected: { kind: "jjit", slug: "devops-engineer-123" },
  },

  // ── Trailing dot ──────────────────────────────────────────────────────────
  {
    desc: "trailing dot on linkedin.com host",
    input: "https://linkedin.com./jobs/view/123456789/",
    expected: null,
  },

  // ── Userinfo / port-prefix bypass ─────────────────────────────────────────
  {
    desc: "userinfo bypass: www.linkedin.com@evil.com — hostname is evil.com",
    input: "https://www.linkedin.com@evil.com/jobs/view/123456789/",
    expected: null,
  },

  // ── F3 regression guard (subdomain / suffix confusion) ───────────────────
  {
    desc: "evil.linkedin.com subdomain (F3 regression — must stay null)",
    input: "https://evil.linkedin.com/jobs/view/123456789/",
    expected: null,
  },
  {
    desc: "attacker.com.linkedin.com suffix confusion",
    input: "https://attacker.com.linkedin.com/jobs/view/123456789/",
    expected: null,
  },
  {
    desc: "evil-linkedin.com prefix confusion",
    input: "https://evil-linkedin.com/jobs/view/123456789/",
    expected: null,
  },
  {
    desc: "uk.linkedin.com non-allowlisted locale (F3 narrowing)",
    input: "https://uk.linkedin.com/jobs/view/123456789/",
    expected: null,
  },
  {
    desc: "business.linkedin.com non-allowlisted subdomain",
    input: "https://business.linkedin.com/jobs/view/123456789/",
    expected: null,
  },

  // ── Protocol bypass ───────────────────────────────────────────────────────
  {
    desc: "javascript: protocol bare (hostname is empty — host check also catches this)",
    input: "javascript:alert(1)",
    expected: null,
  },
  {
    desc: "javascript: URL with linkedin hostname — protocol check gates this (removing line 14 reds this row)",
    input: "javascript://www.linkedin.com/jobs/view/123456789/",
    expected: null,
  },
  {
    desc: "data: protocol",
    input: "data:text/html,<script>alert(1)</script>",
    expected: null,
  },
  {
    desc: "file: protocol",
    input: "file:///etc/passwd",
    expected: null,
  },

  // ── JJIT rejection cases ─────────────────────────────────────────────────
  {
    desc: "www.justjoin.it — www subdomain intentionally blocked",
    input: "https://www.justjoin.it/job-offer/some-slug",
    expected: null,
  },
  {
    desc: "justjoin.it with extra path segments",
    input: "https://justjoin.it/job-offer/some-slug/extra",
    expected: null,
  },
  {
    desc: "justjoin.it slug with uppercase (regex allows only [a-z0-9-])",
    input: "https://justjoin.it/job-offer/Senior-Developer",
    expected: null,
  },

  // ── Non-portal / internal ─────────────────────────────────────────────────
  {
    desc: "non-portal URL",
    input: "https://example.com/jobs/view/123456789/",
    expected: null,
  },
  {
    desc: "internal metadata IP",
    input: "https://169.254.169.254/latest/meta-data/",
    expected: null,
  },

  // ── jobId / slug shape violations ─────────────────────────────────────────
  {
    desc: "LinkedIn jobId too short (7 digits — minimum is 8)",
    input: "https://www.linkedin.com/jobs/view/1234567/",
    expected: null,
  },

  // ── IDN look-alike ────────────────────────────────────────────────────────
  {
    desc: "IDN look-alike: Cyrillic і in linkedіn.com → punycode mismatch",
    input: "https://linkedіn.com/jobs/view/123456789/",
    expected: null,
  },

  // ── Malformed / empty ────────────────────────────────────────────────────
  {
    desc: "empty string",
    input: "",
    expected: null,
  },
  {
    desc: "not a URL",
    input: "not-a-url",
    expected: null,
  },
];

describe("recognize()", () => {
  it.each(table)("$desc", ({ input, expected }) => {
    expect(recognize(input)).toEqual(expected);
  });
});
