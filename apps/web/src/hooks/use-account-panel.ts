import {
  initializeAnalytics,
  resetAnalytics,
} from "@pcobooster/analytics/client";
import type { PlanningCenterAccountsResponse } from "@pcobooster/contracts/accounts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { QueryFunctionContext } from "@tanstack/react-query";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { useState } from "react";

import { useBrowserStorage } from "@/hooks/use-browser-storage";
import {
  ACCOUNT_PANEL_CACHE_KEY,
  parseCachedAccountPanel,
  serializeAccountPanel,
  summarizeAccountPanel,
} from "@/lib/account-panel-cache";
import { clearAccountScopedCaches } from "@/lib/account-scoped-caches";
import { authClient } from "@/lib/auth-client";
import { writeBrowserStorage } from "@/lib/browser-storage";
import { queryKeys } from "@/lib/query-keys";
import { orpc } from "@/orpc-client";

export const fetchAccounts = async ({
  signal,
}: QueryFunctionContext): Promise<PlanningCenterAccountsResponse> => {
  const response = await orpc.accounts.list({}, { signal });
  if (response.demo) {
    resetAnalytics();
  } else {
    initializeAnalytics(
      import.meta.env.VITE_POSTHOG_KEY,
      import.meta.env.PROD,
      response.session.userId
    );
  }
  writeBrowserStorage(
    ACCOUNT_PANEL_CACHE_KEY,
    serializeAccountPanel(summarizeAccountPanel(response))
  );
  return response;
};

export const useAccountsQuery = () =>
  useQuery({ queryKey: queryKeys.accounts(), queryFn: fetchAccounts });

const signOutSession = async () => {
  const result = await authClient.signOut();
  if (result.error) {
    throw new Error(result.error.message ?? "Unable to sign out");
  }
};

/** Leaves the account signed in on this browser so the sign-in page can resume it. */
const leaveSession = async () => {
  // Better Auth rejects a POST without a JSON content type, so send an empty body.
  const result = await authClient.$fetch("/device-accounts/leave", {
    method: "POST",
    body: {},
  });
  if (result.error) {
    throw new Error(result.error.message ?? "Unable to switch accounts");
  }
};

const exitDemoSession = async () => {
  await orpc.demo.exit({});
};

export const signOutLabel = (demo: boolean, pending: boolean): string => {
  if (demo) {
    return pending ? "Leaving demo…" : "Exit demo";
  }
  return pending ? "Signing out…" : "Sign out";
};

/** Account switching and sign-out shared by the sidebar menu and the mobile account sheet. */
export const useAccountPanel = ({
  onAccountSwitched,
}: {
  onAccountSwitched?: () => void;
} = {}) => {
  const router = useRouter();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const accountsQuery = useAccountsQuery();
  const data = accountsQuery.data ?? null;
  const loading = accountsQuery.isPending;
  const [cachedPanel] = useBrowserStorage(ACCOUNT_PANEL_CACHE_KEY);
  const cachedSummary = parseCachedAccountPanel(cachedPanel);
  const [switchingAccountId, setSwitchingAccountId] = useState<string | null>(
    null
  );
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [actionError, setActionError] = useState("");
  const panelError = actionError || (accountsQuery.error?.message ?? "");
  const demo = data?.demo === true;
  const liveSummary = summarizeAccountPanel(data);
  const summary = data ? liveSummary : (cachedSummary ?? liveSummary);

  const selectAccount = async (accountId: string) => {
    if (switchingAccountId !== null || isSigningOut) {
      return;
    }
    setActionError("");
    setSwitchingAccountId(accountId);
    try {
      await orpc.accounts.select({ accountId });
      clearAccountScopedCaches();
      await accountsQuery.refetch();
      await queryClient.invalidateQueries();
      await router.invalidate();
      onAccountSwitched?.();
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Failed to switch organization"
      );
    }
    setSwitchingAccountId(null);
  };

  const signOut = async ({ keepOnDevice = false } = {}) => {
    if (isSigningOut || switchingAccountId !== null) {
      return;
    }
    setActionError("");
    setIsSigningOut(true);
    try {
      if (demo) {
        await exitDemoSession();
      } else if (keepOnDevice) {
        await leaveSession();
      } else {
        await signOutSession();
      }
      resetAnalytics();
      queryClient.clear();
      clearAccountScopedCaches();
      if (demo) {
        // The home page is the marketing site, outside this app's router.
        window.location.assign("/");
        return;
      }
      await navigate({ to: "/auth", replace: true });
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Unable to sign out"
      );
    }
    setIsSigningOut(false);
  };

  return {
    data,
    loading,
    demo,
    summary,
    panelError,
    switchingAccountId,
    isSigningOut,
    selectAccount,
    signOut,
    switchAccount: async () => {
      await signOut({ keepOnDevice: true });
    },
  };
};
