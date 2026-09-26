import {
  CHORD_CHART_CHORD_COLORS,
  CHORD_CHART_FONTS,
  CHORD_CHART_FONT_SIZES,
  CHORD_CHART_MARGINS,
  CHORD_CHART_MAX_COLUMNS,
  CHORD_CHART_ORIENTATIONS,
  CHORD_CHART_PAGE_SIZES,
} from "@pcobooster/contracts/chord-charts";
import type { ChordChartLayout } from "@pcobooster/contracts/chord-charts";
import { Settings2 } from "lucide-react";
import { useId } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

/** The empty option: the setting inherits the organization's default in Services. */
const DEFAULT_VALUE = "";

interface LayoutOption {
  readonly value: string;
  readonly label: string;
}

const COLUMN_OPTIONS: LayoutOption[] = Array.from(
  { length: CHORD_CHART_MAX_COLUMNS },
  (_, index) => ({ value: String(index + 1), label: String(index + 1) })
);

const LayoutSelect = ({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string | number | null;
  options: readonly LayoutOption[];
  onChange: (value: string) => void;
}) => {
  const id = useId();
  const current = value === null ? DEFAULT_VALUE : String(value);
  // A value set in Services that this list lacks stays selectable, so it is not lost.
  const known =
    current === DEFAULT_VALUE ||
    options.some((option) => option.value === current);
  return (
    <div className="flex items-center justify-between gap-3">
      <Label htmlFor={id}>{label}</Label>
      <NativeSelect
        id={id}
        size="sm"
        value={current}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      >
        <NativeSelectOption value={DEFAULT_VALUE}>
          Organization default
        </NativeSelectOption>
        {options.map((option) => (
          <NativeSelectOption key={option.value} value={option.value}>
            {option.label}
          </NativeSelectOption>
        ))}
        {known ? null : (
          <NativeSelectOption value={current}>{current}</NativeSelectOption>
        )}
      </NativeSelect>
    </div>
  );
};

const pick = <Value extends string | number>(
  allowed: readonly Value[],
  raw: string
): Value | null => allowed.find((option) => String(option) === raw) ?? null;

export interface ChordChartLayoutPopoverProps {
  layout: ChordChartLayout;
  onChange: (layout: ChordChartLayout) => void;
}

/** The chart's Formatting settings in Services; they save with the chart. */
export const ChordChartLayoutPopover = ({
  layout,
  onChange,
}: ChordChartLayoutPopoverProps) => {
  const update = (change: Partial<ChordChartLayout>) => {
    onChange({ ...layout, ...change });
  };

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button variant="outline" size="sm" aria-label="Chart formatting" />
        }
      >
        <Settings2 aria-hidden />
        <span className="max-sm:hidden">Formatting</span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <div className="flex flex-col gap-3 p-4">
          <p className="text-sm font-medium">Text</p>
          <LayoutSelect
            label="Font"
            value={layout.font}
            options={CHORD_CHART_FONTS}
            onChange={(value) => {
              update({ font: value === DEFAULT_VALUE ? null : value });
            }}
          />
          <LayoutSelect
            label="Size"
            value={layout.fontSize}
            options={CHORD_CHART_FONT_SIZES.map((size) => ({
              value: String(size),
              label: `${size} pt`,
            }))}
            onChange={(value) => {
              update({ fontSize: pick(CHORD_CHART_FONT_SIZES, value) });
            }}
          />
          <LayoutSelect
            label="Chord color"
            value={layout.chordColor}
            options={CHORD_CHART_CHORD_COLORS.map((color, index) => ({
              value: String(index),
              label: color,
            }))}
            onChange={(value) => {
              update({
                chordColor: value === DEFAULT_VALUE ? null : Number(value),
              });
            }}
          />
          <p className="text-sm font-medium">Layout</p>
          <LayoutSelect
            label="Columns"
            value={layout.columns}
            options={COLUMN_OPTIONS}
            onChange={(value) => {
              update({
                columns: value === DEFAULT_VALUE ? null : Number(value),
              });
            }}
          />
          <LayoutSelect
            label="Page size"
            value={layout.pageSize}
            options={CHORD_CHART_PAGE_SIZES.map((size) => ({
              value: size,
              label: size,
            }))}
            onChange={(value) => {
              update({ pageSize: pick(CHORD_CHART_PAGE_SIZES, value) });
            }}
          />
          <LayoutSelect
            label="Orientation"
            value={layout.orientation}
            options={CHORD_CHART_ORIENTATIONS.map((orientation) => ({
              value: orientation,
              label: orientation,
            }))}
            onChange={(value) => {
              update({ orientation: pick(CHORD_CHART_ORIENTATIONS, value) });
            }}
          />
          <LayoutSelect
            label="Margins"
            value={layout.margin}
            options={CHORD_CHART_MARGINS.map((margin) => ({
              value: margin,
              label: margin.replace("in", " in"),
            }))}
            onChange={(value) => {
              update({ margin: pick(CHORD_CHART_MARGINS, value) });
            }}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
};
