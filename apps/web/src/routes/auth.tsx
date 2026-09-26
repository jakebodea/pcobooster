import { createFileRoute, redirect } from "@tanstack/react-router";

import { AuthSignInCard } from "@/components/auth/auth-sign-in-card";
import { describeSignInError, sanitizeReturnPath } from "@/lib/auth-redirect";
import { authSearchSchema } from "@/lib/route-search";
import {
  getDeviceAccounts,
  getSessionStatus,
} from "@/server/session.functions";

const AuthPage = () => {
  const { returnPath } = Route.useRouteContext();
  const { accounts, now } = Route.useLoaderData();
  const { error } = Route.useSearch();
  return (
    <AuthSignInCard
      returnPath={returnPath}
      deviceAccounts={accounts}
      renderedAt={now}
      initialError={describeSignInError(error ?? null)}
      errorCode={error ?? null}
    />
  );
};

export const Route = createFileRoute("/auth")({
  validateSearch: authSearchSchema,
  beforeLoad: async ({ search }) => {
    const returnPath = sanitizeReturnPath(search.next ?? null);
    const { authenticated } = await getSessionStatus();
    if (authenticated) {
      // The return path may be outside this router, such as `/admin`.
      redirect({ href: returnPath, reloadDocument: true, throw: true });
    }
    return { returnPath };
  },
  loader: async () => {
    const deviceAccounts = await getDeviceAccounts();
    return deviceAccounts;
  },
  head: () => ({
    meta: [
      { title: "Sign in · PCOBooster" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  headers: () => ({ "Cache-Control": "private, no-store" }),
  component: AuthPage,
});
