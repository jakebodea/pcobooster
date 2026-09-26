/**
 * Draws a PDF's pages onto canvases with pdf.js, sized to a width, so a preview can swap in
 * a new render without the flash and scroll reset of reloading the browser's PDF viewer.
 * pdf.js loads on first use: it needs browser APIs and is heavy.
 */

const PAGE_CANVAS_CLASS =
  "block w-full rounded-sm shadow-md ring-1 ring-black/10";

const loadPdfjs = async () => {
  const [pdfjs, worker] = await Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  return pdfjs;
};

let pdfjsLoading: ReturnType<typeof loadPdfjs> | null = null;

export const base64ToBytes = (data: string): Uint8Array =>
  Uint8Array.from(atob(data), (character) => character.codePointAt(0) ?? 0);

/** One canvas per page, `width` CSS pixels wide and sharp on high-density screens. */
export const renderPdfPages = async (
  data: string,
  width: number
): Promise<HTMLCanvasElement[]> => {
  pdfjsLoading ??= loadPdfjs();
  const pdfjs = await pdfjsLoading;
  const loading = pdfjs.getDocument({ data: base64ToBytes(data) });
  const document = await loading.promise;
  try {
    const pixelRatio = window.devicePixelRatio || 1;
    const pageNumbers = Array.from(
      { length: document.numPages },
      (_, index) => index + 1
    );
    return await Promise.all(
      pageNumbers.map(async (pageNumber) => {
        const page = await document.getPage(pageNumber);
        const scale = width / page.getViewport({ scale: 1 }).width;
        const viewport = page.getViewport({ scale: scale * pixelRatio });
        const canvas = window.document.createElement("canvas");
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.aspectRatio = `${viewport.width} / ${viewport.height}`;
        canvas.className = PAGE_CANVAS_CLASS;
        canvas.setAttribute("aria-label", `Page ${String(pageNumber)}`);
        canvas.setAttribute("role", "img");
        await page.render({ canvas, viewport }).promise;
        return canvas;
      })
    );
  } finally {
    await loading.destroy();
  }
};
