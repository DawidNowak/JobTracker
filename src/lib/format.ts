export function parseSourceHref(source: string): string | null {
  try {
    const url = new URL(source);
    if (url.protocol === "http:" || url.protocol === "https:") {
      return url.toString();
    }
  } catch {
    // not a URL
  }
  return null;
}

const dateTimeFormatter = new Intl.DateTimeFormat("pl", { dateStyle: "medium", timeStyle: "short" });

export function formatDateTime(iso: string): string {
  return dateTimeFormatter.format(new Date(iso));
}

const relativeFormatter = new Intl.RelativeTimeFormat("pl", { numeric: "auto" });

const UNITS: { unit: Intl.RelativeTimeFormatUnit; seconds: number }[] = [
  { unit: "year", seconds: 60 * 60 * 24 * 365 },
  { unit: "month", seconds: 60 * 60 * 24 * 30 },
  { unit: "week", seconds: 60 * 60 * 24 * 7 },
  { unit: "day", seconds: 60 * 60 * 24 },
  { unit: "hour", seconds: 60 * 60 },
  { unit: "minute", seconds: 60 },
];

export function formatRelative(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const diffSeconds = Math.round((then.getTime() - now.getTime()) / 1000);
  const absSeconds = Math.abs(diffSeconds);

  if (absSeconds < 60) {
    return "przed chwilą";
  }

  for (const { unit, seconds } of UNITS) {
    if (absSeconds >= seconds) {
      const value = Math.round(diffSeconds / seconds);
      return `dodano ${relativeFormatter.format(value, unit)}`;
    }
  }

  return "przed chwilą";
}
