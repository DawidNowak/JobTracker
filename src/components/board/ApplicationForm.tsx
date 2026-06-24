import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { WorkMode } from "@/lib/validation/applications";
import { workModeValues } from "@/lib/validation/applications";
import type { ReactNode } from "react";

export const NO_WORK_MODE = "__none__";

export interface ApplicationFormValues {
  source: string;
  position: string;
  company: string;
  description: string;
  salary: string;
  work_mode: "" | WorkMode;
  recruiter_contact: string;
}

interface Props {
  idPrefix: string;
  form: ApplicationFormValues;
  update: <K extends keyof ApplicationFormValues>(key: K, value: ApplicationFormValues[K]) => void;
  errors: Record<string, string>;
  afterSource?: ReactNode;
}

export default function ApplicationForm({ idPrefix, form, update, errors, afterSource }: Props) {
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-source`}>Źródło *</Label>
        <Input
          id={`${idPrefix}-source`}
          aria-required="true"
          value={form.source}
          onChange={(e) => {
            update("source", e.target.value);
          }}
          autoFocus
        />
        {errors.source && <p className="text-xs text-red-600">{errors.source}</p>}
        {afterSource}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-position`}>Stanowisko</Label>
        <Input
          id={`${idPrefix}-position`}
          value={form.position}
          onChange={(e) => {
            update("position", e.target.value);
          }}
        />
        {errors.position && <p className="text-xs text-red-600">{errors.position}</p>}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-company`}>Firma</Label>
        <Input
          id={`${idPrefix}-company`}
          value={form.company}
          onChange={(e) => {
            update("company", e.target.value);
          }}
        />
        {errors.company && <p className="text-xs text-red-600">{errors.company}</p>}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-description`}>Opis i wymagane umiejętności</Label>
        <Textarea
          id={`${idPrefix}-description`}
          rows={5}
          className="max-h-48"
          value={form.description}
          onChange={(e) => {
            update("description", e.target.value);
          }}
        />
        <p className="text-xs text-neutral-500">Wklej opis oferty wraz z listą wymaganych umiejętności.</p>
        {errors.description && <p className="text-xs text-red-600">{errors.description}</p>}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-salary`}>Widełki wynagrodzenia</Label>
        <Input
          id={`${idPrefix}-salary`}
          value={form.salary}
          onChange={(e) => {
            update("salary", e.target.value);
          }}
        />
        {errors.salary && <p className="text-xs text-red-600">{errors.salary}</p>}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-work-mode`}>Tryb pracy</Label>
        <Select
          value={form.work_mode === "" ? NO_WORK_MODE : form.work_mode}
          onValueChange={(value) => {
            update("work_mode", value === NO_WORK_MODE ? "" : (value as WorkMode));
          }}
        >
          <SelectTrigger id={`${idPrefix}-work-mode`}>
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
        <Label htmlFor={`${idPrefix}-recruiter`}>Kontakt do rekrutera</Label>
        <Input
          id={`${idPrefix}-recruiter`}
          value={form.recruiter_contact}
          onChange={(e) => {
            update("recruiter_contact", e.target.value);
          }}
        />
        {errors.recruiter_contact && <p className="text-xs text-red-600">{errors.recruiter_contact}</p>}
      </div>
    </>
  );
}
