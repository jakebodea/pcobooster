import path from "node:path";

import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Drizzle from "alchemy/Drizzle";
import * as RemovalPolicy from "alchemy/RemovalPolicy";
import * as State from "alchemy/State";
import { Config, Effect, Layer } from "effect";

import { Database } from "./apps/server/src/database";
import { currentStageSettings } from "./apps/server/src/stage";
import Api from "./apps/server/src/worker";
import { prepareCloudflareBuild } from "./scripts/cloudflare/prepare";
import {
  allowUniversalSslIssuers,
  formerDomainRedirect,
} from "./scripts/cloudflare/zones";

const canAttachDomains = (production: boolean) =>
  production && process.env.CLOUDFLARE_CUSTOM_DOMAINS === "1";

export default Alchemy.Stack(
  "pcobooster",
  {
    providers: Layer.mergeAll(Cloudflare.providers(), Drizzle.providers()),
    state: Layer.unwrap(
      Alchemy.Stage.pipe(
        Effect.map((stage) =>
          stage === "local" ? State.localState() : Cloudflare.state()
        )
      )
    ),
  },
  Effect.gen(function* infrastructure() {
    const { stage, production, local, publicOrigin } =
      yield* currentStageSettings;
    process.env.ADMIN_BASE_PATH = production ? "" : "/admin";
    yield* Effect.promise(async () => {
      await prepareCloudflareBuild(stage);
    });
    const attachDomains = canAttachDomains(production);
    const zone = production
      ? yield* Cloudflare.Zone.Zone("Zone", {
          name: "pcobooster.com",
          type: "full",
        }).pipe(RemovalPolicy.retain())
      : undefined;
    if (zone !== undefined) {
      yield* allowUniversalSslIssuers("", zone, "pcobooster.com");
    }
    // Serves nothing until the registrar delegates the domain to this zone's nameservers.
    const formerZone = production
      ? yield* formerDomainRedirect(publicOrigin)
      : undefined;
    const database = yield* Database;
    // Effect-native: it reads its own settings and binds the database (`apps/server/src/worker.ts`).
    const api = yield* Api;
    // TanStack Start; its Vite `base` (and router basepath) come from ADMIN_BASE_PATH above.
    const admin = yield* Cloudflare.Website.Vite("Admin", {
      name: `pcobooster-${stage}-admin`,
      rootDir: path.join(import.meta.dirname, "apps/admin"),
      workersDev: production,
      domain: attachDomains
        ? { name: "admin.pcobooster.com", zone }
        : undefined,
      compatibility: { date: "2026-09-01", flags: ["nodejs_compat"] },
      dev: { host: "127.0.0.1", port: 3003, strictPort: true },
      memo: {
        // Explicit globs also hash the gitignored cloudflare-build-inputs.json stamp,
        // which carries the stage (and so the base path) into the rebuild key.
        include: ["**/*"],
        exclude: [
          "node_modules/**",
          "dist/**",
          ".tanstack/**",
          ".turbo/**",
          ".wrangler/**",
          "*.tsbuildinfo",
        ],
        lockfile: true,
      },
      env: {
        API: api,
        PRODUCT_ORIGIN: publicOrigin,
      },
    });
    // TanStack Start. Its build stages the marketing site into `public/marketing` first.
    const web = yield* Cloudflare.Website.Vite("Web", {
      name: `pcobooster-${stage}-web`,
      rootDir: path.join(import.meta.dirname, "apps/web"),
      domain: attachDomains
        ? { name: "pcobooster.com", aliases: ["www.pcobooster.com"], zone }
        : undefined,
      compatibility: { date: "2026-09-01", flags: ["nodejs_compat"] },
      dev: { host: "127.0.0.1", port: 3001, strictPort: true },
      memo: {
        // Explicit globs also hash the gitignored cloudflare-build-inputs.json stamp, which
        // carries build-time variables and the marketing sources into the rebuild key.
        include: ["**/*"],
        exclude: [
          "node_modules/**",
          "dist/**",
          "public/marketing/**",
          ".tanstack/**",
          ".turbo/**",
          ".wrangler/**",
          "*.tsbuildinfo",
        ],
        lockfile: true,
      },
      env: {
        API: api,
        ADMIN: admin,
        PRODUCT_ORIGIN: publicOrigin,
        // The deployed commit, served at `/version` for post-deploy verification. As an env
        // prop it is part of the Worker's change hash, so every commit redeploys it.
        PCOBOOSTER_VERSION: Config.String("GITHUB_SHA").pipe(
          Config.withDefault("")
        ),
        // Local stage only, like the API's; production builds ignore it regardless.
        DEV_AUTH_BYPASS: local
          ? Config.String("DEV_AUTH_BYPASS").pipe(Config.withDefault(""))
          : "",
      },
    });
    return {
      web: web.url,
      admin: production ? admin.url : `${publicOrigin}/admin`,
      databaseId: database.databaseId,
      nameServers: zone?.nameServers,
      formerDomainNameServers: formerZone?.nameServers,
    };
  })
);
