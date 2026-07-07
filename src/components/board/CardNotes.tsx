import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { ApplicationNoteRow } from "@/types";

interface Props {
  applicationId: string;
}

export default function CardNotes({ applicationId }: Props) {
  const [notes, setNotes] = useState<ApplicationNoteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [bannerError, setBannerError] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/applications/${applicationId}/notes`)
      .then((res) => res.json())
      .then((data: { notes: ApplicationNoteRow[] }) => {
        if (!cancelled) {
          setNotes(data.notes);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setBannerError("Nie udało się załadować notatek.");
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [applicationId]);

  const handleAdd = async () => {
    const trimmed = body.trim();
    if (!trimmed) return;
    setSubmitting(true);
    setBannerError(null);
    try {
      const res = await fetch(`/api/applications/${applicationId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: trimmed }),
      });
      if (res.status === 201) {
        const data = (await res.json()) as { note: ApplicationNoteRow };
        setNotes((prev) => [data.note, ...prev]);
        setBody("");
        textareaRef.current?.focus();
      } else {
        setBannerError("Nie udało się dodać notatki. Spróbuj ponownie.");
      }
    } catch {
      setBannerError("Nie udało się dodać notatki. Spróbuj ponownie.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold text-neutral-900">Notatki</h3>

      {bannerError && (
        <div role="alert" className={cn("rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700")}>
          {bannerError}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <Textarea
          ref={textareaRef}
          placeholder="Dodaj notatkę…"
          value={body}
          onChange={(e) => {
            setBody(e.target.value);
          }}
          rows={3}
          className="resize-none text-sm"
        />
        <Button size="sm" disabled={submitting || !body.trim()} onClick={() => void handleAdd()}>
          {submitting ? "Dodawanie…" : "Dodaj notatkę"}
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-neutral-500">Ładowanie…</p>
      ) : notes.length === 0 ? (
        <p className="text-sm text-neutral-500">Brak notatek.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {notes.map((note) => (
            <li key={note.id} className="rounded-md border border-neutral-200 bg-neutral-50 p-3">
              <p className="text-sm whitespace-pre-wrap text-neutral-800">{note.body}</p>
              <p className="mt-1 text-xs text-neutral-500">{formatDateTime(note.created_at)}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
