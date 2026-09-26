import { Outlet, createFileRoute } from "@tanstack/react-router";

import { AppShell } from "@/components/app-shell";
import { chordChartsFeatureQueryOptions } from "@/lib/chord-charts-route";
import { cleanupFeatureQueryOptions } from "@/lib/cleanup-route";
import { peopleFeatureQueryOptions } from "@/lib/people-route";

const AppLayout = () => (
  <AppShell>
    <Outlet />
  </AppShell>
);

/**
 * Signed-in product pages. The shell renders on the server; each page renders in the
 * browser from its query caches, with its skeleton as the server fallback.
 */
export const Route = createFileRoute("/_app")({
  // The navigation shows People, Songs, and Data cleanup only when their flags are on.
  // Loading the answers here renders the server HTML with them, so the links never flash.
  loader: async ({ context }) => {
    await Promise.allSettled([
      // A failed answer keeps its link hidden; the pages do not depend on it.
      context.queryClient.query(peopleFeatureQueryOptions),
      context.queryClient.query(chordChartsFeatureQueryOptions),
      context.queryClient.query(cleanupFeatureQueryOptions),
    ]);
  },
  headers: () => ({ "Cache-Control": "private, no-store" }),
  // Not-found pages bubble to the root, which renders them inside the shell.
  component: AppLayout,
});
