import { cn } from "@/lib/utils";
import { formatRelative } from "@/lib/format";
import type { ApplicationRow } from "@/types";

interface Props {
  application: ApplicationRow;
}

export default function KanbanCard({ application }: Props) {
  let sourceHref: string | null = null;
  try {
    const url = new URL(application.source);
    if (url.protocol === "http:" || url.protocol === "https:") {
      sourceHref = url.toString();
    }
  } catch {
    sourceHref = null;
  }

  const relative = formatRelative(application.last_action_at);

  return (
    <article className={cn("rounded-md border border-neutral-200 bg-white p-3 shadow-sm")}>
      <div className="flex flex-col gap-1">
        <p className="text-sm font-semibold text-neutral-900">{application.company ?? "—"}</p>
        {application.position && <p className="text-sm text-neutral-700">{application.position}</p>}
        {sourceHref && (
          <a
            href={sourceHref}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-600 hover:underline"
          >
            Link do oferty
          </a>
        )}
        {application.work_mode && (
          <span className="inline-flex w-fit items-center rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-700">
            {application.work_mode}
          </span>
        )}
        <p className="text-xs text-neutral-500">{relative}</p>
      </div>
    </article>
  );
}
