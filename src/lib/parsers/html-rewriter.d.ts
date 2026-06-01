interface HTMLRewriterTextChunk {
  text: string;
}

interface HTMLRewriterInstance {
  on(selector: string, handlers: { text(t: HTMLRewriterTextChunk): void }): HTMLRewriterInstance;
  transform(response: Response): Response;
}

type HTMLRewriterCtor = new () => HTMLRewriterInstance;

declare const HTMLRewriter: HTMLRewriterCtor;
