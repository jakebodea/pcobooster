import { createFileRoute } from "@tanstack/react-router";

import {
  ChordChartEditorPage,
  ChordChartEditorPageSkeleton,
} from "@/components/songs/chord-chart-editor-page";
import { assertChordChartsEnabled } from "@/lib/chord-charts-route";
import { songChartSearchSchema } from "@/lib/route-search";

const SongChartRoute = () => {
  const { songId } = Route.useParams();
  const { arrangement } = Route.useSearch();
  return (
    <ChordChartEditorPage songId={songId} arrangementId={arrangement ?? null} />
  );
};

export const Route = createFileRoute("/_app/songs/$songId")({
  validateSearch: songChartSearchSchema,
  ssr: "data-only",
  beforeLoad: assertChordChartsEnabled,
  pendingComponent: ChordChartEditorPageSkeleton,
  component: SongChartRoute,
});
