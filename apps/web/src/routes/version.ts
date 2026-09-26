import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";

/** The commit this web Worker was deployed from; `verify-deployment.ts` polls it. */
export const Route = createFileRoute("/version")({
  server: {
    handlers: {
      GET: () =>
        Response.json(
          { version: env.PCOBOOSTER_VERSION },
          { headers: { "Cache-Control": "no-store" } }
        ),
    },
  },
});
