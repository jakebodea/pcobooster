import { createFileRoute } from "@tanstack/react-router";

import { CleanupPage } from "@/components/cleanup/cleanup-page";
import { assertCleanupPageEnabled } from "@/lib/cleanup-route";

export const Route = createFileRoute("/_app/cleanup/")({
  // Route checks run on the server; the page renders from browser caches.
  ssr: "data-only",
  beforeLoad: assertCleanupPageEnabled,
  component: CleanupPage,
});
