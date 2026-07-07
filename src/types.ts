import type { Database } from "@/lib/database.types";

export type ApplicationRow = Database["public"]["Tables"]["applications"]["Row"];
export type ApplicationNoteRow = Database["public"]["Tables"]["application_notes"]["Row"];
