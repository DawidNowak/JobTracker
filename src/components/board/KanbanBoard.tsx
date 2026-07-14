import { useEffect, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import AddApplicationDialog from "@/components/board/AddApplicationDialog";
import KanbanCard from "@/components/board/KanbanCard";
import KanbanColumn from "@/components/board/KanbanColumn";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { applicationStatusValues } from "@/lib/validation/applications";
import type { ApplicationStatus } from "@/lib/validation/applications";
import type { ApplicationRow } from "@/types";

interface Props {
  applications: Record<ApplicationStatus, ApplicationRow[]>;
}

function findCard(state: Record<ApplicationStatus, ApplicationRow[]>, id: string): ApplicationRow | undefined {
  for (const status of applicationStatusValues) {
    const found = state[status].find((c) => c.id === id);
    if (found) return found;
  }
  return undefined;
}

async function readError(res: Response): Promise<string> {
  try {
    const payload = (await res.json()) as { error?: string };
    if (payload.error) return payload.error;
  } catch {
    // ignore
  }
  return "Nie udało się zaktualizować aplikacji.";
}

export default function KanbanBoard({ applications: initial }: Props) {
  const [applications, setApplications] = useState<Record<ApplicationStatus, ApplicationRow[]>>(initial);
  const [error, setError] = useState<string | null>(null);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [isMutating, setIsMutating] = useState(false);
  const boardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    boardRef.current?.setAttribute("data-board-hydrated", "true");
  }, []);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const onDragStart = (event: DragStartEvent) => {
    setActiveDragId(String(event.active.id));
  };

  const onDragEnd = (event: DragEndEvent) => {
    setActiveDragId(null);
    if (isMutating) return;

    const from = event.active.data.current?.from as ApplicationStatus | undefined;
    const to = event.over?.id as ApplicationStatus | undefined;
    if (!from || !to || from === to) return;

    const cardId = String(event.active.id);
    const card = applications[from].find((c) => c.id === cardId);
    if (!card) return;

    const snapshot = applications;
    const movedAt = new Date().toISOString();
    setApplications({
      ...applications,
      [from]: applications[from].filter((c) => c.id !== card.id),
      [to]: [{ ...card, status: to, last_action_at: movedAt }, ...applications[to]],
    });

    setIsMutating(true);
    fetch(`/api/applications/${card.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: to }),
    })
      .then(async (res) => {
        if (!res.ok) {
          setApplications(snapshot);
          setError(await readError(res));
        }
      })
      .catch(() => {
        setApplications(snapshot);
        setError("Brak połączenia. Spróbuj ponownie.");
      })
      .finally(() => {
        setIsMutating(false);
      });
  };

  const onApply = (cardId: string) => {
    if (isMutating) return;
    const card = applications["Interesujące"].find((c) => c.id === cardId);
    if (!card) return;

    const snapshot = applications;
    const movedAt = new Date().toISOString();
    setApplications({
      ...applications,
      Interesujące: applications["Interesujące"].filter((c) => c.id !== cardId),
      Zaaplikowano: [{ ...card, status: "Zaaplikowano", last_action_at: movedAt }, ...applications.Zaaplikowano],
    });

    setIsMutating(true);
    fetch(`/api/applications/${cardId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "Zaaplikowano" }),
    })
      .then(async (res) => {
        if (!res.ok) {
          setApplications(snapshot);
          setError(await readError(res));
        }
      })
      .catch(() => {
        setApplications(snapshot);
        setError("Brak połączenia. Spróbuj ponownie.");
      })
      .finally(() => {
        setIsMutating(false);
      });
  };

  const activeCard = activeDragId ? findCard(applications, activeDragId) : undefined;

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <div ref={boardRef} data-board-hydrated="false">
        {error && (
          <div
            role="alert"
            className={cn(
              "mb-3 flex items-start justify-between rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700",
            )}
          >
            <span>{error}</span>
            <Button
              variant="ghost"
              size="sm"
              className="-mt-1 h-6 px-2 text-red-700 hover:bg-red-100 hover:text-red-800"
              onClick={() => {
                setError(null);
              }}
              aria-label="Zamknij komunikat"
            >
              ×
            </Button>
          </div>
        )}
        <div className="flex gap-4">
          {applicationStatusValues.map((status) => (
            <KanbanColumn
              key={status}
              title={status}
              applications={applications[status]}
              isMutating={isMutating}
              onApply={onApply}
              headerAction={
                status === "Interesujące" || status === "Zaaplikowano" ? (
                  <AddApplicationDialog targetStatus={status} />
                ) : undefined
              }
            />
          ))}
        </div>
      </div>
      <DragOverlay>{activeCard ? <KanbanCard application={activeCard} isOverlay /> : null}</DragOverlay>
    </DndContext>
  );
}
