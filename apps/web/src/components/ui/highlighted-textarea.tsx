import { cn } from "cn";
import * as React from "react";

type HighlightedTextareaProps = Omit<
  React.ComponentProps<"textarea">,
  "value" | "children"
> & {
  value: string;
  /** Colored copy of `value`. It must keep every character so the layers stay aligned. */
  highlight: React.ReactNode;
};

/**
 * Metrics both layers share; any difference drifts the highlight off the caret. Both keep a
 * scrollbar gutter so the textarea's scrollbar cannot rewrap only one of them.
 */
const LAYER_CLASS =
  "absolute inset-0 m-0 size-full border-0 px-4 py-3 font-mono text-[13px] leading-6 tracking-normal break-words whitespace-pre-wrap [scrollbar-gutter:stable] [tab-size:4]";

/** A trailing newline needs a character after it to take up a line. */
const TRAILING_LINE_FILLER = "\u200B";

/**
 * A plain-text editor with syntax coloring: a transparent textarea over a highlighted
 * copy of its text. The textarea keeps native editing, undo, and selection.
 */
const HighlightedTextarea = ({
  className,
  value,
  highlight,
  onScroll,
  ref,
  ...props
}: HighlightedTextareaProps) => {
  const highlightRef = React.useRef<HTMLDivElement>(null);

  const syncScroll = (event: React.UIEvent<HTMLTextAreaElement>) => {
    const layer = highlightRef.current;
    if (layer !== null) {
      layer.scrollTop = event.currentTarget.scrollTop;
      layer.scrollLeft = event.currentTarget.scrollLeft;
    }
    onScroll?.(event);
  };

  return (
    <div
      data-slot="highlighted-textarea"
      className={cn(
        "bg-input/30 focus-within:border-ring focus-within:ring-ring/30 relative min-h-0 overflow-hidden rounded-2xl border border-transparent focus-within:ring-3",
        className
      )}
    >
      <div
        ref={highlightRef}
        aria-hidden
        className={cn(LAYER_CLASS, "text-foreground overflow-hidden")}
      >
        {highlight}
        {TRAILING_LINE_FILLER}
      </div>
      <textarea
        ref={ref}
        data-slot="highlighted-textarea-input"
        value={value}
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
        autoCorrect="off"
        onScroll={syncScroll}
        className={cn(
          LAYER_CLASS,
          "caret-foreground selection:bg-primary/25 placeholder:text-muted-foreground resize-none overflow-auto bg-transparent text-transparent outline-none"
        )}
        {...props}
      />
    </div>
  );
};

export { HighlightedTextarea };
