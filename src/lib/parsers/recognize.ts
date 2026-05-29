export type RecognizedSource = { kind: "linkedin"; jobId: string } | { kind: "jjit"; slug: string };

export function recognize(source: string): RecognizedSource | null {
  const trimmed = source.trim();
  if (trimmed.length === 0) return null;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  const host = url.hostname.toLowerCase();

  if (host === "linkedin.com" || host.endsWith(".linkedin.com")) {
    const fromQuery = url.searchParams.get("currentJobId");
    if (fromQuery && /^\d{8,}$/.test(fromQuery)) {
      return { kind: "linkedin", jobId: fromQuery };
    }
    const fromPath = /(\d{8,})(?:[/?#]|$)/.exec(url.pathname);
    if (fromPath) {
      return { kind: "linkedin", jobId: fromPath[1] };
    }
    return null;
  }

  if (host === "justjoin.it") {
    const match = /^\/job-offer\/([a-z0-9-]+)\/?$/.exec(url.pathname);
    if (match) {
      return { kind: "jjit", slug: match[1] };
    }
    return null;
  }

  return null;
}
