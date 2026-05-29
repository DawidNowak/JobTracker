import type { WorkMode } from "@/lib/validation/applications";

export interface ParseResult {
  position?: string;
  company?: string;
  description?: string;
  salary?: string;
  work_mode?: WorkMode;
}

export type ParseStatus = "ok" | "partial" | "empty" | "unsupported" | "fetch_failed";

export interface ParseEndpointResponse {
  result: ParseResult;
  status: ParseStatus;
  message?: string;
}
