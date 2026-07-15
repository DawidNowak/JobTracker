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

export default function RejectApplicationDialog({ application, open, onOpenChange }: Props) {
  const [bannerError, setBannerError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setBannerError(null);
      setRejecting(false);
    }
    onOpenChange(next);
  };

  const handleConfirm = async () => {
    setRejecting(true);
    setBannerError(null);
    try {
      const res = await fetch(`/api/applications/${application.id}/archive`, { method: "POST" });
      if (res.status === 200) {
        onOpenChange(false);
        window.location.reload();
        return;
      }
      setBannerError("Nie udało się odrzucić aplikacji. Spróbuj ponownie.");
    } catch {
      setBannerError("Nie udało się odrzucić aplikacji. Spróbuj ponownie.");
    } finally {
      setRejecting(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Odrzuć aplikację</AlertDialogTitle>
          <AlertDialogDescription>
            Aplikacja zostanie przeniesiona do archiwum i zniknie z tablicy.
          </AlertDialogDescription>
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
            disabled={rejecting}
          >
            {rejecting ? "Odrzucanie…" : "Odrzuć"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
