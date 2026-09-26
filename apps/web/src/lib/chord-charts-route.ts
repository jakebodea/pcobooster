import type { QueryClient } from "@tanstack/react-query";

import { createFeatureQueryOptions, requireFeature } from "@/lib/feature-query";
import { getChordChartsFeature } from "@/server/features.functions";

/**
 * The API's `chordCharts` flag answer. The app layout loads it on the server, so the
 * navigation renders with it and never flashes the Songs link.
 */
export const chordChartsFeatureQueryOptions = createFeatureQueryOptions(
  "chordCharts",
  async () => await getChordChartsFeature()
);

/** Song chart pages 404 unless the API's `chordCharts` flag is on for this visitor. */
export const assertChordChartsEnabled = async ({
  context,
}: {
  context: { queryClient: QueryClient };
}): Promise<void> => {
  await requireFeature(context.queryClient, chordChartsFeatureQueryOptions);
};
