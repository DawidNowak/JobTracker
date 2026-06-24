import { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import type { ApplicationRow } from "@/types";

interface Props {
  application: ApplicationRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function deleteMessage(status: ApplicationRow["status"]): string {
  if (status === "Interesujące") {
    return "Usunąć tę aplikację? Tej akcji nie można cofnąć.";
  }
  return "Rekord nie zostanie zachowany w archiwum. Tej akcji nie można cofnąć.";
}

export default function DeleteApplicationDialog({ application, open, onOpenChange }: Props) {
  const [bannerError, setBannerError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setBannerError(null);
      setDeleting(false);
    }
    onOpenChange(next);
  };

  const handleConfirm = async () => {
    setDeleting(true);
    setBannerError(null);
    try {
      const res = await fetch(`/api/applications/${application.id}`, { method: "DELETE" });
      if (res.status === 200 || res.status === 204) {
        onOpenChange(false);
        window.location.reload();
        return;
      }
      setBannerError("Nie udało się usunąć aplikacji. Spróbuj ponownie.");
    } catch {
      setBannerError("Nie udało się usunąć aplikacji. Spróbuj ponownie.");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Usuń aplikację</AlertDialogTitle>
          <AlertDialogDescription>{deleteMessage(application.status)}</AlertDialogDescription>
        </AlertDialogHeader>
        {bannerError && (
          <div role="alert" className={cn("rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700")}>
            {bannerError}
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>Anuluj</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              void handleConfirm();
            }}
            disabled={deleting}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {deleting ? "Usuwanie…" : "Usuń"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
