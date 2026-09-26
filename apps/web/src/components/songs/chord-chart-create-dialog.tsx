import type { ChordChartArrangement } from "@pcobooster/contracts/chord-charts";
import { useId, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { Spinner } from "@/components/ui/spinner";
import {
  chordChartErrorMessage,
  useCreateChordChart,
} from "@/hooks/use-chord-chart-song";
import type { ChordChartDraft } from "@/lib/chord-chart-draft";

export interface ChordChartCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  songId: string;
  /** The chart the new arrangement starts with. */
  draft: ChordChartDraft;
  onCreated: (arrangement: ChordChartArrangement) => void;
}

/** Creates an arrangement in Planning Center holding the current chart. */
export const ChordChartCreateDialog = ({
  open,
  onOpenChange,
  songId,
  draft,
  onCreated,
}: ChordChartCreateDialogProps) => {
  const nameId = useId();
  const [name, setName] = useState("");
  const createChart = useCreateChordChart(songId);
  const trimmedName = name.trim();

  const create = () => {
    if (trimmedName === "" || createChart.isPending) {
      return;
    }
    createChart.mutate(
      {
        songId,
        name: trimmedName,
        chordChart: draft.chart,
        chordChartKey: draft.key,
        layout: draft.layout,
      },
      {
        onSuccess: (arrangement) => {
          setName("");
          onOpenChange(false);
          onCreated(arrangement);
        },
        onError: (error) => {
          toast.error(chordChartErrorMessage(error));
        },
      }
    );
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="max-w-md">
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            create();
          }}
        >
          <ResponsiveDialogHeader className="text-left">
            <ResponsiveDialogTitle>New arrangement</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              Creates the arrangement in Planning Center with this chart, its
              key, and its page layout.
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <div className="flex flex-col gap-2 max-md:px-4">
            <Label htmlFor={nameId}>Name</Label>
            <Input
              id={nameId}
              autoFocus
              placeholder="Acoustic"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
          </div>
          <ResponsiveDialogFooter>
            <Button
              type="submit"
              disabled={trimmedName === "" || createChart.isPending}
            >
              {createChart.isPending ? <Spinner aria-hidden /> : null}
              Create in Planning Center
            </Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
};
