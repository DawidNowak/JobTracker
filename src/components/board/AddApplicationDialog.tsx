import { useState, type SyntheticEvent } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { ApplicationStatus } from "@/lib/validation/applications";
import { recognize } from "@/lib/parsers/recognize";
import type { ParseEndpointResponse, ParseResult, ParseStatus } from "@/lib/parsers/types";
import ApplicationForm, { type ApplicationFormValues } from "@/components/board/ApplicationForm";

type AddableStatus = Exclude<ApplicationStatus, "Rozmowa">;

interface Props {
  targetStatus: AddableStatus;
}

const EMPTY_FORM: ApplicationFormValues = {
  source: "",
  position: "",
  company: "",
  description: "",
  salary: "",
  work_mode: "",
  recruiter_contact: "",
};

function nullableOrString(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export default function AddApplicationDialog({ targetStatus }: Props) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<ApplicationFormValues>(EMPTY_FORM);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [bannerError, setBannerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [parseStatus, setParseStatus] = useState<ParseStatus | null>(null);
  const [parseMessage, setParseMessage] = useState<string | null>(null);

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
    setOpen(next);
    if (!next) {
      setForm(EMPTY_FORM);
      setErrors({});
      setBannerError(null);
      setSubmitting(false);
      setParsing(false);
      setParseStatus(null);
      setParseMessage(null);
    }
  };

  const canParse = recognize(form.source.trim()) !== null && !parsing;

  const handleParse = async () => {
    setParsing(true);
    setParseStatus(null);
    setParseMessage(null);
    try {
      const res = await fetch("/api/applications/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: form.source.trim() }),
      });
      if (res.status !== 200) {
        setParseStatus("fetch_failed");
        setParseMessage("Nie udało się pobrać danych. Wypełnij ręcznie.");
        return;
      }
      const payload = (await res.json()) as ParseEndpointResponse;
      const result: ParseResult = payload.result;
      if (result.position !== undefined) update("position", result.position);
      if (result.company !== undefined) update("company", result.company);
      if (result.description !== undefined) update("description", result.description);
      if (result.salary !== undefined) update("salary", result.salary);
      if (result.work_mode !== undefined) update("work_mode", result.work_mode);
      setParseStatus(payload.status);
      setParseMessage(payload.message ?? null);
    } catch {
      setParseStatus("fetch_failed");
      setParseMessage("Nie udało się pobrać danych. Wypełnij ręcznie.");
    } finally {
      setParsing(false);
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
      status: targetStatus,
    };

    try {
      const res = await fetch("/api/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.status === 201) {
        setOpen(false);
        window.location.reload();
        return;
      }

      if (res.status === 422) {
        const payload = (await res.json()) as { errors?: Record<string, string> };
        setErrors(payload.errors ?? {});
        return;
      }

      setBannerError("Nie udało się zapisać aplikacji. Spróbuj ponownie.");
    } catch {
      setBannerError("Nie udało się zapisać aplikacji. Spróbuj ponownie.");
    } finally {
      setSubmitting(false);
    }
  };

  const triggerLabel = targetStatus === "Interesujące" ? "Dodaj do Interesujące" : "Dodaj do Zaaplikowano";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={triggerLabel}>
          <Plus className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[90vh] flex-col gap-0 overflow-hidden sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Nowa aplikacja w kolumnie {targetStatus}</DialogTitle>
          <DialogDescription className="sr-only">Formularz dodawania nowej aplikacji.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-col gap-4 overflow-y-auto pr-1">
            {parseMessage && parseStatus !== "ok" && (
              <div
                role="status"
                className={cn("rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800")}
              >
                {parseMessage}
              </div>
            )}
            {bannerError && (
              <div role="alert" className={cn("rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700")}>
                {bannerError}
              </div>
            )}
            <ApplicationForm
              idPrefix="add-application"
              form={form}
              update={update}
              errors={errors}
              afterSource={
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    void handleParse();
                  }}
                  disabled={!canParse}
                  className="self-start"
                >
                  {parsing ? "Pobieranie…" : "Pobierz dane oferty"}
                </Button>
              }
            />
          </div>

          <DialogFooter className="mt-4 shrink-0 border-t pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setOpen(false);
              }}
            >
              Anuluj
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Zapisywanie…" : "Dodaj"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
