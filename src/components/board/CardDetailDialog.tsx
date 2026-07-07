import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { parseSourceHref } from "@/lib/format";
import CardNotes from "@/components/board/CardNotes";
import type { ApplicationRow } from "@/types";

interface Props {
  application: ApplicationRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function CardDetailDialog({ application, open, onOpenChange }: Props) {
  const handleOpenChange = (next: boolean) => {
    onOpenChange(next);
    if (!next) {
      window.location.reload();
    }
  };

  const sourceHref = parseSourceHref(application.source);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col gap-0 overflow-hidden sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {application.company ?? "—"}
            {application.position ? ` — ${application.position}` : ""}
          </DialogTitle>
          <DialogDescription className="sr-only">Szczegóły aplikacji i notatki.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 overflow-y-auto pt-2 pr-1">
          <section className="flex flex-col gap-2">
            {sourceHref && (
              <DetailRow label="Link do oferty">
                <a
                  href={sourceHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-blue-600 hover:underline"
                >
                  {sourceHref}
                </a>
              </DetailRow>
            )}
            {application.work_mode && (
              <DetailRow label="Tryb pracy">
                <span className="text-sm text-neutral-800">{application.work_mode}</span>
              </DetailRow>
            )}
            {application.salary && (
              <DetailRow label="Wynagrodzenie">
                <span className="text-sm text-neutral-800">{application.salary}</span>
              </DetailRow>
            )}
            {application.description && (
              <DetailRow label="Opis">
                <p className="text-sm whitespace-pre-wrap text-neutral-800">{application.description}</p>
              </DetailRow>
            )}
            {application.recruiter_contact && (
              <DetailRow label="Kontakt do rekrutera">
                <span className="text-sm text-neutral-800">{application.recruiter_contact}</span>
              </DetailRow>
            )}
          </section>

          <div className="border-t pt-4">
            <CardNotes applicationId={application.id} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs font-medium text-neutral-500">{label}</span>
      {children}
    </div>
  );
}
