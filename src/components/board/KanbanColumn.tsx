import type { ReactNode } from "react";
import KanbanCard from "@/components/board/KanbanCard";
import type { ApplicationRow } from "@/types";

interface Props {
  title: string;
  applications: ApplicationRow[];
  headerAction?: ReactNode;
}

export default function KanbanColumn({ title, applications, headerAction }: Props) {
  const isEmpty = applications.length === 0;

  return (
    <div className="flex min-h-[400px] flex-1 flex-col rounded-lg border border-neutral-200 bg-white">
      <header className="flex items-center justify-between border-b border-neutral-200 px-4 py-3">
        <h2 className="text-sm font-semibold text-neutral-900">{title}</h2>
        {headerAction}
      </header>
      {isEmpty ? (
        <div className="flex flex-1 items-center justify-center p-4">
          <p className="text-sm text-neutral-400">Brak aplikacji</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2 p-3">
          {applications.map((application) => (
            <KanbanCard key={application.id} application={application} />
          ))}
        </div>
      )}
    </div>
  );
}
