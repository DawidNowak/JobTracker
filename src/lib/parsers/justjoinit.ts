import type { WorkMode } from "@/lib/validation/applications";
import type { ParseResult } from "./types";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const CONTRACT_LABELS: Record<string, string> = {
  b2b: "B2B",
  permanent: "UoP",
  mandate_contract: "UZ",
  internship_contract: "staż",
};

interface EmploymentType {
  type?: string;
  from?: number | null;
  to?: number | null;
  currency?: string | null;
  unit?: string | null;
  salary?: {
    from?: number | null;
    to?: number | null;
    currency?: string | null;
  };
}

interface OfferShape {
  title?: string;
  company_name?: string;
  body?: string;
  workplace_type?: string;
  required_skills?: unknown;
  employment_types?: EmploymentType[];
}

function formatNumber(value: number): string {
  const rounded = Math.round(value);
  const sign = rounded < 0 ? "-" : "";
  const digits = Math.abs(rounded).toString();
  let out = "";
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += " ";
    out += digits[i];
  }
  return sign + out;
}

function formatSalary(rows: EmploymentType[] | undefined): string | undefined {
  if (!Array.isArray(rows)) return undefined;
  const parts: string[] = [];
  for (const row of rows) {
    const inner = row.salary ?? row;
    const from = inner.from;
    const to = inner.to;
    if (from == null) continue;
    const currency = (inner.currency ?? "PLN").toUpperCase();
    const unit = row.unit ?? "mies.";
    const contractKey = (row.type ?? "").toLowerCase();
    const contractLabel = contractKey in CONTRACT_LABELS ? CONTRACT_LABELS[contractKey] : (row.type ?? "");
    const labelSuffix = contractLabel ? ` (${contractLabel})` : "";
    if (to == null) {
      parts.push(`${formatNumber(from)}+ ${currency}/${unit}${labelSuffix}`);
    } else {
      parts.push(`${formatNumber(from)} – ${formatNumber(to)} ${currency}/${unit}${labelSuffix}`);
    }
  }
  if (parts.length === 0) return undefined;
  return parts.join("; ");
}

function mapWorkplaceType(value: unknown): WorkMode | undefined {
  if (typeof value !== "string") return undefined;
  const v = value.toLowerCase();
  if (v === "remote") return "Zdalna";
  if (v === "hybrid" || v === "partly_remote") return "Hybrydowa";
  if (v === "office") return "Stacjonarna";
  return undefined;
}

function extractOfferObject(flight: string): OfferShape {
  const titleIdx = flight.indexOf('"title"');
  if (titleIdx < 0) throw new Error("offer marker not found");

  let openIdx = -1;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = titleIdx; i >= 0; i--) {
    const ch = flight[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (inString) {
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "}") depth++;
    else if (ch === "{") {
      if (depth === 0) {
        openIdx = i;
        break;
      }
      depth--;
    }
  }
  if (openIdx < 0) throw new Error("offer object opening brace not found");

  let closeIdx = -1;
  depth = 0;
  inString = false;
  escape = false;
  for (let i = openIdx; i < flight.length; i++) {
    const ch = flight[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (inString) {
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        closeIdx = i;
        break;
      }
    }
  }
  if (closeIdx < 0) throw new Error("offer object closing brace not found");

  const slice = flight.slice(openIdx, closeIdx + 1);
  if (!slice.includes('"title"') || !slice.includes('"workplace_type"')) {
    throw new Error("offer slice missing expected keys");
  }
  return JSON.parse(slice) as OfferShape;
}

interface HTMLRewriterTextChunk {
  text: string;
}

interface HTMLRewriterInstance {
  on(selector: string, handlers: { text(t: HTMLRewriterTextChunk): void }): HTMLRewriterInstance;
  transform(response: Response): Response;
}

type HTMLRewriterCtor = new () => HTMLRewriterInstance;

declare const HTMLRewriter: HTMLRewriterCtor;

export async function parseJustJoinIT(slug: string): Promise<ParseResult> {
  const url = `https://justjoin.it/job-offer/${slug}`;
  const response = await fetch(url, {
    signal: AbortSignal.timeout(8000),
    headers: {
      "User-Agent": USER_AGENT,
      "Accept-Language": "en-US,en;q=0.9,pl;q=0.8",
    },
  });
  if (response.status !== 200) {
    throw new Error(`JJIT non-200 status: ${response.status}`);
  }

  let scriptBuffer = "";
  const rewritten = new HTMLRewriter()
    .on("script", {
      text(t) {
        scriptBuffer += t.text;
      },
    })
    .transform(response);
  await rewritten.text();

  const chunks: string[] = [];
  for (const m of scriptBuffer.matchAll(/self\.__next_f\.push\(\[1,(".*?")\]\)/gs)) {
    try {
      const parsed = JSON.parse(m[1]) as unknown;
      if (typeof parsed === "string") chunks.push(parsed);
    } catch {
      // skip malformed chunk
    }
  }
  const flight = chunks.join("");
  if (flight.length === 0) throw new Error("no flight chunks");

  const offer = extractOfferObject(flight);

  const result: ParseResult = {};
  if (typeof offer.title === "string" && offer.title.length > 0) {
    result.position = offer.title;
  }
  if (typeof offer.company_name === "string" && offer.company_name.length > 0) {
    result.company = offer.company_name;
  }

  let description = typeof offer.body === "string" ? offer.body : "";
  if (Array.isArray(offer.required_skills) && offer.required_skills.length > 0) {
    const skills = offer.required_skills
      .map((s) => {
        if (typeof s === "string") return s;
        if (s && typeof s === "object" && "name" in s && typeof (s as { name: unknown }).name === "string") {
          return (s as { name: string }).name;
        }
        return null;
      })
      .filter((s): s is string => s !== null && s.length > 0);
    if (skills.length > 0) {
      description = `Wymagane umiejętności: ${skills.join(", ")}\n\n${description}`;
    }
  }
  if (description.length > 0) {
    result.description = description;
  }

  const salary = formatSalary(offer.employment_types);
  if (salary) result.salary = salary;

  const workMode = mapWorkplaceType(offer.workplace_type);
  if (workMode) result.work_mode = workMode;

  return result;
}
