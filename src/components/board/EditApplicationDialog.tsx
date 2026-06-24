import { useState, type SyntheticEvent } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { ApplicationRow } from "@/types";
import ApplicationForm, { type ApplicationFormValues } from "@/components/board/ApplicationForm";
import type { WorkMode } from "@/lib/validation/applications";

function nullableOrString(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function rowToForm(application: ApplicationRow): ApplicationFormValues {
  return {
    source: application.source,
    position: application.position ?? "",
    company: application.company ?? "",
    description: application.description ?? "",
    salary: application.salary ?? "",
    work_mode: (application.work_mode as WorkMode | null) ?? "",
    recruiter_contact: application.recruiter_contact ?? "",
  };
}

interface Props {
  application: ApplicationRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function EditApplicationDialog({ application, open, onOpenChange }: Props) {
  const [form, setForm] = useState<ApplicationFormValues>(() => rowToForm(application));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [bannerError, setBannerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const update = <K extends keyof ApplicationFormValues>(key: K, value: ApplicationFormValues[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) {
      setErrors((prev) => {
        const { [key]: _removed, ...rest } = prev;
        void _removed;
        return rest;
      });
    }
  };

  const handleOpenChange = (next: boolean) => {
    onOpenChange(next);
    if (!next) {
      setForm(rowToForm(application));
      setErrors({});
      setBannerError(null);
      setSubmitting(false);
    }
  };

  const handleSubmit = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setBannerError(null);

    const body = {
      source: form.source.trim(),
      position: nullableOrString(form.position),
      company: nullableOrString(form.company),
      description: nullableOrString(form.description),
      salary: nullableOrString(form.salary),
      work_mode: form.work_mode === "" ? null : form.work_mode,
      recruiter_contact: nullableOrString(form.recruiter_contact),
    };

    try {
      const res = await fetch(`/api/applications/${application.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.status === 200) {
        onOpenChange(false);
        window.location.reload();
        return;
      }

      if (res.status === 422) {
        const payload = (await res.json()) as { errors?: Record<string, string> };
        setErrors(payload.errors ?? {});
        return;
      }

      setBannerError("Nie udało się zapisać zmian. Spróbuj ponownie.");
    } catch {
      setBannerError("Nie udało się zapisać zmian. Spróbuj ponownie.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col gap-0 overflow-hidden sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edytuj aplikację</DialogTitle>
          <DialogDescription className="sr-only">Formularz edycji aplikacji.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-col gap-4 overflow-y-auto pr-1">
            {bannerError && (
              <div role="alert" className={cn("rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700")}>
                {bannerError}
              </div>
            )}
            <ApplicationForm idPrefix="edit-application" form={form} update={update} errors={errors} />
          </div>

          <DialogFooter className="mt-4 shrink-0 border-t pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                handleOpenChange(false);
              }}
            >
              Anuluj
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Zapisywanie…" : "Zapisz"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
