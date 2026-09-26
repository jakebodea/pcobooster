/**
 * Bindings Alchemy gives the product Worker (`alchemy.run.ts`). Declared here rather than by
 * loading `@cloudflare/workers-types` globally, whose `Request`/`Response` clash with the DOM lib.
 */
declare module "cloudflare:workers" {
  /** A service binding or the static assets binding. */
  interface Fetcher {
    fetch: (request: Request) => Promise<Response>;
  }

  interface WebWorkerEnv {
    /** The API Worker. */
    API: Fetcher;
    /** The admin Worker, served under `/admin` outside production. */
    ADMIN: Fetcher;
    /** Static assets, including the staged marketing site. */
    ASSETS: Fetcher;
    PRODUCT_ORIGIN: string;
    /** The deployed commit; empty outside CI deploys. */
    PCOBOOSTER_VERSION: string;
    /** Local stage only; ignored by production builds. */
    DEV_AUTH_BYPASS?: string;
  }

  export const env: WebWorkerEnv;
}
