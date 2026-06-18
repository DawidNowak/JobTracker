import { vi } from "vitest";

export async function withFetchStub(
  handler: (req: Request) => Response | Promise<Response>,
  fn: () => Promise<void>,
): Promise<void> {
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    return Promise.resolve(handler(req));
  });
  try {
    await fn();
  } finally {
    vi.unstubAllGlobals();
  }
}
