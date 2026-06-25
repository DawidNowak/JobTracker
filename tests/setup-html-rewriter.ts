import { HTMLRewriter as WasmHTMLRewriter } from "html-rewriter-wasm";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

class HTMLRewriter {
  private _handlers: Array<{ selector: string; handlers: object }> = [];

  on(selector: string, handlers: object): this {
    this._handlers.push({ selector, handlers });
    return this;
  }

  transform(response: Response): { text(): Promise<string> } {
    const { _handlers } = this;
    return {
      async text(): Promise<string> {
        let output = "";
        const rewriter = new WasmHTMLRewriter((chunk: Uint8Array) => {
          output += decoder.decode(chunk);
        });
        for (const { selector, handlers } of _handlers) {
          rewriter.on(selector, handlers as Parameters<typeof rewriter.on>[1]);
        }
        try {
          const html = await response.text();
          await rewriter.write(encoder.encode(html));
          await rewriter.end();
        } finally {
          rewriter.free();
        }
        return output;
      },
    };
  }
}

(globalThis as unknown as Record<string, unknown>).HTMLRewriter = HTMLRewriter;
