interface HTMLRewriterTextChunk {
  text: string;
}

interface HTMLRewriterElement {
  readonly tagName: string;
  onEndTag(handler: (end: { readonly name: string }) => void): void;
}

interface HTMLRewriterHandlers {
  text?(t: HTMLRewriterTextChunk): void;
  element?(e: HTMLRewriterElement): void;
}

interface HTMLRewriterInstance {
  on(selector: string, handlers: HTMLRewriterHandlers): HTMLRewriterInstance;
  transform(response: Response): Response;
}

type HTMLRewriterCtor = new () => HTMLRewriterInstance;

declare const HTMLRewriter: HTMLRewriterCtor;
