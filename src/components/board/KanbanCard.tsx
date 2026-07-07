import { useState } from "react";
import { useDraggable } from "@dnd-kit/core";
import { MoreVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatRelative, parseSourceHref } from "@/lib/format";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import EditApplicationDialog from "@/components/board/EditApplicationDialog";
import DeleteApplicationDialog from "@/components/board/DeleteApplicationDialog";
import CardDetailDialog from "@/components/board/CardDetailDialog";
import type { ApplicationRow } from "@/types";

interface Props {
  application: ApplicationRow;
  isOverlay?: boolean;
  isMutating?: boolean;
}

export default function KanbanCard({ application, isOverlay = false, isMutating = false }: Props) {
  if (isOverlay) {
    return <KanbanCardBody application={application} />;
  }
  return <KanbanCardDraggable application={application} isMutating={isMutating} />;
}

function KanbanCardDraggable({ application, isMutating }: { application: ApplicationRow; isMutating: boolean }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);

  const anyOpen = menuOpen || editOpen || deleteOpen || detailOpen;

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: application.id,
    data: { from: application.status },
    disabled: isMutating || anyOpen,
  });

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={cn("touch-none", isDragging ? "opacity-0" : "cursor-grab active:cursor-grabbing")}
    >
      <KanbanCardBody
        application={application}
        showActions
        menuOpen={menuOpen}
        onMenuOpenChange={setMenuOpen}
        editOpen={editOpen}
        onEditOpenChange={setEditOpen}
        deleteOpen={deleteOpen}
        onDeleteOpenChange={setDeleteOpen}
        detailOpen={detailOpen}
        onDetailOpenChange={setDetailOpen}
      />
    </div>
  );
}

interface CardBodyProps {
  application: ApplicationRow;
  showActions?: boolean;
  menuOpen?: boolean;
  onMenuOpenChange?: (open: boolean) => void;
  editOpen?: boolean;
  onEditOpenChange?: (open: boolean) => void;
  deleteOpen?: boolean;
  onDeleteOpenChange?: (open: boolean) => void;
  detailOpen?: boolean;
  onDetailOpenChange?: (open: boolean) => void;
}

function KanbanCardBody({
  application,
  showActions = false,
  menuOpen,
  onMenuOpenChange,
  editOpen,
  onEditOpenChange,
  deleteOpen,
  onDeleteOpenChange,
  detailOpen,
  onDetailOpenChange,
}: CardBodyProps) {
  const sourceHref = parseSourceHref(application.source);
  const relative = formatRelative(application.last_action_at);

  return (
    <article className={cn("rounded-md border border-neutral-200 bg-white p-3 shadow-sm")}>
      <div className="flex flex-col gap-1">
        <div className="flex items-start justify-between gap-1">
          <p className="text-sm font-semibold text-neutral-900">{application.company ?? "—"}</p>
          {showActions && (
            <DropdownMenu open={menuOpen} onOpenChange={onMenuOpenChange}>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="-mt-1 -mr-1 h-6 w-6 shrink-0 text-neutral-500 hover:text-neutral-900"
                  aria-label="Opcje aplikacji"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                  }}
                >
                  <MoreVertical className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onSelect={() => {
                    onDetailOpenChange?.(true);
                  }}
                >
                  Szczegóły
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => {
                    onEditOpenChange?.(true);
                  }}
                >
                  Edytuj
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => {
                    onDeleteOpenChange?.(true);
                  }}
                  className="text-destructive focus:text-destructive"
                >
                  Usuń
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
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
      {showActions && detailOpen !== undefined && onDetailOpenChange && (
        <CardDetailDialog application={application} open={detailOpen} onOpenChange={onDetailOpenChange} />
      )}
      {showActions && editOpen !== undefined && onEditOpenChange && (
        <EditApplicationDialog application={application} open={editOpen} onOpenChange={onEditOpenChange} />
      )}
      {showActions && deleteOpen !== undefined && onDeleteOpenChange && (
        <DeleteApplicationDialog application={application} open={deleteOpen} onOpenChange={onDeleteOpenChange} />
      )}
    </article>
  );
}
