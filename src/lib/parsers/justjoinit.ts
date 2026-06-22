import type { WorkMode } from "@/lib/validation/applications";
import type { ParseResult } from "./types";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const MAX_BUFFER_CHARS = 4_000_000;
const MAX_OFFER_CANDIDATES = 8;

const CONTRACT_LABELS: Record<string, string> = {
  b2b: "B2B",
  permanent: "UoP",
  mandate_contract: "UZ",
  contract: "UoD",
  internship: "staż",
  // legacy keys retained for forward-compat if JJIT ever flips back
  internship_contract: "staż",
};

interface EmploymentType {
  type?: string;
  from?: number | null;
  to?: number | null;
  currency?: string | null;
  unit?: string | null;
  // Legacy nested shape; current JJIT puts from/to/currency directly on the row.
  salary?: {
    from?: number | null;
    to?: number | null;
    currency?: string | null;
  };
}

interface OfferShape {
  title?: string;
  companyName?: string;
  // Body can be either a plain HTML string or a Flight text reference like "$48".
  body?: string;
  // workplaceType is now an object { label, value }; older payloads were a plain string.
  workplaceType?: string | { label?: string; value?: string };
  requiredSkills?: unknown;
  employmentTypes?: EmploymentType[];
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
  let v: string | undefined;
  if (typeof value === "string") v = value;
  else if (value && typeof value === "object" && "value" in value) {
    const raw = value.value;
    if (typeof raw === "string") v = raw;
  }
  if (!v) return undefined;
  const lower = v.toLowerCase();
  if (lower === "remote") return "Zdalna";
  if (lower === "hybrid" || lower === "partly_remote") return "Hybrydowa";
  if (lower === "office") return "Stacjonarna";
  return undefined;
}

// Resolve a Flight text reference of the form "$<hex>" against the joined flight buffer.
// Flight encoding writes the referenced text as "\n<id>:T<hex-length>,<text>" inside the buffer.
// If `ref` does not look like a reference, return it unchanged (some payloads inline the HTML).
function resolveTextRef(flight: string, ref: string): string | undefined {
  if (!ref.startsWith("$")) return ref;
  const id = ref.slice(1);
  if (!/^[0-9a-fA-F]+$/.test(id)) return undefined;
  const re = new RegExp(`(?:^|\\n)${id}:T([0-9a-fA-F]+),`);
  const m = re.exec(flight);
  if (!m) return undefined;
  const len = Number.parseInt(m[1], 16);
  if (!Number.isFinite(len) || len < 0) return undefined;
  const start = m.index + m[0].length;
  return flight.slice(start, start + len);
}

const HTML_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&nbsp;": " ",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&lt;": "<",
  "&gt;": ">",
};

function htmlToPlainText(html: string): string {
  return html
    .replace(/<\/p>\s*<\/li>/gi, "</li>")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|ul|ol|div|h[1-6])\s*>/gi, "\n")
    .replace(/<\s*li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&[a-z#0-9]+;/gi, (m) => HTML_ENTITIES[m.toLowerCase()] ?? m)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function sliceObjectAround(flight: string, keyIdx: number): string | null {
  // Walk backward from keyIdx (the opening `"` of a JSON key) to find the enclosing `{`.
  // keyIdx points at `"`; the char to its right is string content, so we start inString=true
  // and the first `"` toggles us OUT of the string.
  let openIdx = -1;
  let depth = 0;
  let inString = true;
  for (let i = keyIdx; i >= 0; i--) {
    const ch = flight[i];
    if (ch === '"') {
      // A `"` is escaped iff preceded by an odd run of backslashes.
      let bs = 0;
      for (let j = i - 1; j >= 0 && flight[j] === "\\"; j--) bs++;
      if (bs % 2 === 0) inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "}") depth++;
    else if (ch === "{") {
      if (depth === 0) {
        openIdx = i;
        break;
      }
      depth--;
    }
  }
  if (openIdx < 0) return null;

  let closeIdx = -1;
  depth = 0;
  inString = false;
  for (let i = openIdx; i < flight.length; i++) {
    const ch = flight[i];
    if (ch === '"') {
      let bs = 0;
      for (let j = i - 1; j >= 0 && flight[j] === "\\"; j--) bs++;
      if (bs % 2 === 0) inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        closeIdx = i;
        break;
      }
    }
  }
  if (closeIdx < 0) return null;
  return flight.slice(openIdx, closeIdx + 1);
}

function extractOfferObject(flight: string): OfferShape {
  // Use "workplaceType" as the marker — it's a single, offer-specific key (current JJIT shape).
  // Each candidate match yields an enclosing-object slice; accept the first one that also
  // contains "title" and "companyName" and JSON-parses.
  let searchStart = 0;
  let candidatesTried = 0;
  while (searchStart < flight.length) {
    if (candidatesTried >= MAX_OFFER_CANDIDATES) {
      throw new Error(`offer object not located after ${candidatesTried} candidate(s)`);
    }
    const idx = flight.indexOf('"workplaceType"', searchStart);
    if (idx < 0) {
      throw new Error(
        candidatesTried === 0
          ? "offer marker not found"
          : `offer object not located after ${candidatesTried} candidate(s)`,
      );
    }
    searchStart = idx + 1;
    candidatesTried++;

    const slice = sliceObjectAround(flight, idx);
    if (slice === null) continue;
    if (!slice.includes('"title"') || !slice.includes('"companyName"')) continue;
    try {
      return JSON.parse(slice) as OfferShape;
    } catch {
      continue;
    }
  }
  throw new Error("offer marker not found");
}

export async function parseJustJoinIT(slug: string): Promise<ParseResult> {
  if (!/^[a-z0-9-]+$/.test(slug)) throw new Error("parseJustJoinIT: invalid slug");
  const url = `https://justjoin.it/job-offer/${encodeURIComponent(slug)}`;
  const response = await fetch(url, {
    redirect: "manual",
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
  if (scriptBuffer.length > MAX_BUFFER_CHARS) {
    throw new Error(`JJIT scriptBuffer too large: ${scriptBuffer.length}`);
  }

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
  if (flight.length > MAX_BUFFER_CHARS) {
    throw new Error(`JJIT flight buffer too large: ${flight.length}`);
  }

  const offer = extractOfferObject(flight);

  const result: ParseResult = {};
  if (typeof offer.title === "string" && offer.title.length > 0) {
    result.position = offer.title;
  }
  if (typeof offer.companyName === "string" && offer.companyName.length > 0) {
    result.company = offer.companyName;
  }

  let description = "";
  if (typeof offer.body === "string" && offer.body.length > 0) {
    const raw = resolveTextRef(flight, offer.body) ?? "";
    description = htmlToPlainText(raw);
  }
  if (Array.isArray(offer.requiredSkills) && offer.requiredSkills.length > 0) {
    const skills = offer.requiredSkills
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

  const salary = formatSalary(offer.employmentTypes);
  if (salary) result.salary = salary;

  const workMode = mapWorkplaceType(offer.workplaceType);
  if (workMode) result.work_mode = workMode;

  return result;
}
