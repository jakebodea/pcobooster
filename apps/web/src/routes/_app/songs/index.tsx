import { createFileRoute } from "@tanstack/react-router";

import { SongsPage, SongsPageSkeleton } from "@/components/songs/songs-page";
import { assertChordChartsEnabled } from "@/lib/chord-charts-route";

export const Route = createFileRoute("/_app/songs/")({
  // Route checks run on the server; the page renders from browser caches.
  ssr: "data-only",
  beforeLoad: assertChordChartsEnabled,
  pendingComponent: SongsPageSkeleton,
  component: SongsPage,
});
