import { Button } from "@/components/ui/button";
import type { PeopleDashboardProgress as Progress } from "@/lib/people-dashboard";

interface PeopleDashboardProgressProps {
  progress: Progress | undefined;
  isLoadingActivity: boolean;
  failedBatchCount: number;
  canLoadMore: boolean;
  onRetry: () => void;
  onLoadMore: () => void;
}

const describeProgress = (
  progress: Progress,
  isLoadingActivity: boolean
): string => {
  if (isLoadingActivity) {
    return `Loading schedules: ${progress.hydratedPeopleCount} of ${progress.requestedPeopleCount} people.`;
  }
  return `Showing ${progress.hydratedPeopleCount} of ${progress.scopePeopleCount} people.`;
};

/** How much of the roster has schedules loaded, with retry and load-more actions. */
export const PeopleDashboardProgress = ({
  progress,
  isLoadingActivity,
  failedBatchCount,
  canLoadMore,
  onRetry,
  onLoadMore,
}: PeopleDashboardProgressProps) => {
  if (!progress) {
    return null;
  }
  const complete =
    !isLoadingActivity &&
    failedBatchCount === 0 &&
    progress.hydratedPeopleCount >= progress.scopePeopleCount;
  if (complete) {
    return null;
  }
  return (
    <div
      className="text-muted-foreground flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs"
      aria-live="polite"
    >
      <span className="tabular-nums">
        {describeProgress(progress, isLoadingActivity)}
      </span>
      {failedBatchCount > 0 ? (
        <>
          <span className="text-destructive">
            Some schedules failed to load.
          </span>
          <Button variant="outline" size="xs" onClick={onRetry}>
            Retry
          </Button>
        </>
      ) : null}
      {canLoadMore && failedBatchCount === 0 ? (
        <Button variant="outline" size="xs" onClick={onLoadMore}>
          Load more people
        </Button>
      ) : null}
    </div>
  );
};
