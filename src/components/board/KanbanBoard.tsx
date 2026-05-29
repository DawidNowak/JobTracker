import { useState } from "react";
import AddApplicationDialog from "@/components/board/AddApplicationDialog";
import KanbanColumn from "@/components/board/KanbanColumn";
import { applicationStatusValues } from "@/lib/validation/applications";
import type { ApplicationStatus } from "@/lib/validation/applications";
import type { ApplicationRow } from "@/types";

interface Props {
  applications: Record<ApplicationStatus, ApplicationRow[]>;
}

export default function KanbanBoard({ applications: initial }: Props) {
  const [applications] = useState<Record<ApplicationStatus, ApplicationRow[]>>(initial);

  return (
    <div className="flex gap-4">
      {applicationStatusValues.map((status) => (
        <KanbanColumn
          key={status}
          title={status}
          applications={applications[status]}
          headerAction={
            status === "Interesujące" || status === "Zaaplikowano" ? (
              <AddApplicationDialog targetStatus={status} />
            ) : undefined
          }
        />
      ))}
    </div>
  );
}
