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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { ApplicationStatus, WorkMode } from "@/lib/validation/applications";
import { workModeValues } from "@/lib/validation/applications";

type AddableStatus = Exclude<ApplicationStatus, "Rozmowa">;

interface Props {
  targetStatus: AddableStatus;
}

const NO_WORK_MODE = "__none__";

const EMPTY_FORM = {
  source: "",
  position: "",
  company: "",
  description: "",
  salary: "",
  work_mode: "" as "" | WorkMode,
  recruiter_contact: "",
};

type FormState = typeof EMPTY_FORM;

function nullableOrString(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export default function AddApplicationDialog({ targetStatus }: Props) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [bannerError, setBannerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
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
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Nowa aplikacja w kolumnie {targetStatus}</DialogTitle>
          <DialogDescription className="sr-only">Formularz dodawania nowej aplikacji.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {bannerError && (
            <div role="alert" className={cn("rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700")}>
              {bannerError}
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="add-application-source">Źródło *</Label>
            <Input
              id="add-application-source"
              aria-required="true"
              value={form.source}
              onChange={(e) => {
                update("source", e.target.value);
              }}
              autoFocus
            />
            {errors.source && <p className="text-xs text-red-600">{errors.source}</p>}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="add-application-position">Stanowisko</Label>
            <Input
              id="add-application-position"
              value={form.position}
              onChange={(e) => {
                update("position", e.target.value);
              }}
            />
            {errors.position && <p className="text-xs text-red-600">{errors.position}</p>}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="add-application-company">Firma</Label>
            <Input
              id="add-application-company"
              value={form.company}
              onChange={(e) => {
                update("company", e.target.value);
              }}
            />
            {errors.company && <p className="text-xs text-red-600">{errors.company}</p>}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="add-application-description">Opis i wymagane umiejętności</Label>
            <Textarea
              id="add-application-description"
              rows={5}
              value={form.description}
              onChange={(e) => {
                update("description", e.target.value);
              }}
            />
            <p className="text-xs text-neutral-500">Wklej opis oferty wraz z listą wymaganych umiejętności.</p>
            {errors.description && <p className="text-xs text-red-600">{errors.description}</p>}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="add-application-salary">Widełki wynagrodzenia</Label>
            <Input
              id="add-application-salary"
              value={form.salary}
              onChange={(e) => {
                update("salary", e.target.value);
              }}
            />
            {errors.salary && <p className="text-xs text-red-600">{errors.salary}</p>}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="add-application-work-mode">Tryb pracy</Label>
            <Select
              value={form.work_mode === "" ? NO_WORK_MODE : form.work_mode}
              onValueChange={(value) => {
                update("work_mode", value === NO_WORK_MODE ? "" : (value as WorkMode));
              }}
            >
              <SelectTrigger id="add-application-work-mode">
                <SelectValue placeholder="Nie wybrano" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_WORK_MODE}>Nie wybrano</SelectItem>
                {workModeValues.map((mode) => (
                  <SelectItem key={mode} value={mode}>
                    {mode}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.work_mode && <p className="text-xs text-red-600">{errors.work_mode}</p>}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="add-application-recruiter">Kontakt do rekrutera</Label>
            <Input
              id="add-application-recruiter"
              value={form.recruiter_contact}
              onChange={(e) => {
                update("recruiter_contact", e.target.value);
              }}
            />
            {errors.recruiter_contact && <p className="text-xs text-red-600">{errors.recruiter_contact}</p>}
          </div>

          <DialogFooter>
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
