import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
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

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState("");
  const [savingEditId, setSavingEditId] = useState<string | null>(null);

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

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

  const startEdit = (note: ApplicationNoteRow) => {
    setEditingId(note.id);
    setEditBody(note.body);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditBody("");
  };

  const handleSaveEdit = async (noteId: string) => {
    const trimmed = editBody.trim();
    if (!trimmed) return;
    setSavingEditId(noteId);
    setBannerError(null);
    try {
      const res = await fetch(`/api/applications/${applicationId}/notes/${noteId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: trimmed }),
      });
      if (res.status === 200) {
        const data = (await res.json()) as { note: ApplicationNoteRow };
        setNotes((prev) => prev.map((n) => (n.id === noteId ? data.note : n)));
        setEditingId(null);
        setEditBody("");
      } else {
        setBannerError("Nie udało się zapisać notatki. Spróbuj ponownie.");
      }
    } catch {
      setBannerError("Nie udało się zapisać notatki. Spróbuj ponownie.");
    } finally {
      setSavingEditId(null);
    }
  };

  const handleConfirmDelete = async () => {
    if (!confirmDeleteId) return;
    const noteId = confirmDeleteId;
    setDeletingId(noteId);
    setBannerError(null);
    try {
      const res = await fetch(`/api/applications/${applicationId}/notes/${noteId}`, {
        method: "DELETE",
      });
      if (res.status === 200) {
        setNotes((prev) => prev.filter((n) => n.id !== noteId));
        setConfirmDeleteId(null);
      } else {
        setBannerError("Nie udało się usunąć notatki. Spróbuj ponownie.");
      }
    } catch {
      setBannerError("Nie udało się usunąć notatki. Spróbuj ponownie.");
    } finally {
      setDeletingId(null);
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
          {notes.map((note) =>
            editingId === note.id ? (
              <li key={note.id} className="rounded-md border border-neutral-200 bg-neutral-50 p-3">
                <Textarea
                  value={editBody}
                  onChange={(e) => {
                    setEditBody(e.target.value);
                  }}
                  rows={3}
                  className="resize-none bg-white text-sm"
                  autoFocus
                />
                <div className="mt-2 flex justify-end gap-2">
                  <Button size="sm" variant="outline" disabled={savingEditId === note.id} onClick={cancelEdit}>
                    Anuluj
                  </Button>
                  <Button
                    size="sm"
                    disabled={savingEditId === note.id || !editBody.trim()}
                    onClick={() => void handleSaveEdit(note.id)}
                  >
                    {savingEditId === note.id ? "Zapisywanie…" : "Zapisz"}
                  </Button>
                </div>
              </li>
            ) : (
              <li key={note.id} className="rounded-md border border-neutral-200 bg-neutral-50 p-3">
                <p className="text-sm whitespace-pre-wrap text-neutral-800">{note.body}</p>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <p className="text-xs text-neutral-500">{formatDateTime(note.created_at)}</p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="text-xs text-neutral-500 hover:text-neutral-800 hover:underline"
                      onClick={() => {
                        startEdit(note);
                      }}
                    >
                      Edytuj
                    </button>
                    <button
                      type="button"
                      className="text-xs text-red-600 hover:text-red-800 hover:underline"
                      onClick={() => {
                        setConfirmDeleteId(note.id);
                      }}
                    >
                      Usuń
                    </button>
                  </div>
                </div>
              </li>
            ),
          )}
        </ul>
      )}

      <AlertDialog
        open={confirmDeleteId !== null}
        onOpenChange={(next) => {
          if (!next) setConfirmDeleteId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Usuń notatkę</AlertDialogTitle>
            <AlertDialogDescription>Tej akcji nie można cofnąć.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Anuluj</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleConfirmDelete();
              }}
              disabled={deletingId !== null}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deletingId !== null ? "Usuwanie…" : "Usuń"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
