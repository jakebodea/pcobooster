import {
  isChordLine,
  isSectionHeading,
} from "@pcobooster/planning-center-models/chord-chart";
import type { ReactNode } from "react";

const CODE_LINE_PATTERN =
  /^\s*(?:\{\{.*\}\}|COLUMN_BREAK|PAGE_BREAK|(?:TRANSPOSE|REDEFINE)\s+KEY\s+[+-]?\s*\d+)\s*$/iu;
const NOTE_LINE_PATTERN = /^\s*\{.*\}\s*$/u;
const INLINE_CHORD_PATTERN = /\[[^\]\n]*\]/gu;

/** Keys are character offsets into the chart, which identify each piece uniquely. */
const highlightInlineChords = (
  line: string,
  lineOffset: number
): ReactNode[] => {
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const match of line.matchAll(INLINE_CHORD_PATTERN)) {
    parts.push(
      line.slice(cursor, match.index),
      <span key={lineOffset + match.index} className="text-status-info">
        {match[0]}
      </span>
    );
    cursor = match.index + match[0].length;
  }
  parts.push(line.slice(cursor));
  return parts;
};

const highlightLine = (line: string, offset: number): ReactNode => {
  if (CODE_LINE_PATTERN.test(line)) {
    return <span className="text-chart-4">{line}</span>;
  }
  if (NOTE_LINE_PATTERN.test(line)) {
    return <span className="text-muted-foreground">{line}</span>;
  }
  if (isSectionHeading(line)) {
    return <span className="text-status-scheduled">{line}</span>;
  }
  if (isChordLine(line)) {
    return <span className="text-status-info">{line}</span>;
  }
  return highlightInlineChords(line, offset);
};

/** Colors a chart for the editor without changing a single character. */
export const highlightChordChart = (text: string): ReactNode[] => {
  const lines: ReactNode[] = [];
  let offset = 0;
  for (const line of text.split("\n")) {
    const isLast = offset + line.length >= text.length;
    lines.push(
      <span key={offset}>
        {highlightLine(line, offset)}
        {isLast ? null : "\n"}
      </span>
    );
    offset += line.length + 1;
  }
  return lines;
};
