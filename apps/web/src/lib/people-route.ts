import type { QueryClient } from "@tanstack/react-query";

import { createFeatureQueryOptions, requireFeature } from "@/lib/feature-query";
import { getPeopleFeature } from "@/server/features.functions";

/**
 * The API's `people` flag answer. The app layout loads it on the server, so the navigation
 * renders with it and never flashes the People link.
 */
export const peopleFeatureQueryOptions = createFeatureQueryOptions(
  "people",
  async () => await getPeopleFeature()
);

/** People pages 404 unless the API's `people` flag is on for this visitor. */
export const assertPeoplePageEnabled = async ({
  context,
}: {
  context: { queryClient: QueryClient };
}): Promise<void> => {
  await requireFeature(context.queryClient, peopleFeatureQueryOptions);
};
