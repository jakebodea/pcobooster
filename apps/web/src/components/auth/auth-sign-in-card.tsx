import { captureAnalytics } from "@pcobooster/analytics/client";
import { ChevronRight, X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { preconnect } from "react-dom";

import { BrandRocketLogo } from "@/components/brand-rocket-logo";
import { PlanningCenterServicesIcon } from "@/components/planning-center-services-icon";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Item, ItemContent, ItemMedia, ItemTitle } from "@/components/ui/item";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { authClient } from "@/lib/auth-client";
import { SIGN_IN_RETURN_PARAM } from "@/lib/auth-redirect";
import {
  ROCKET_ANIMATION,
  canPlayRocketHoverAnimation,
  playRocketAnimation,
} from "@/lib/brand-rocket-animation";
import type { DeviceAccount } from "@/server/session.functions";

const PLANNING_CENTER_ORIGINS = [
  "https://api.planningcenteronline.com",
  "https://login.planningcenteronline.com",
] as const;

const START_SIGN_IN_ERROR = "Unable to start sign in. Please try again.";

/** Better Auth keeps OAuth state for 10 minutes; refresh well before that. */
const PREPARED_URL_MAX_AGE_MS = 5 * 60 * 1000;

interface PreparedAuthorization {
  createdAt: number;
  url: Promise<string>;
}

const buildErrorCallbackUrl = (returnPath: string): string => {
  const params = new URLSearchParams({ [SIGN_IN_RETURN_PARAM]: returnPath });
  return new URL(
    `/auth?${params.toString()}`,
    window.location.origin
  ).toString();
};

const requestAuthorizationUrl = async (returnPath: string): Promise<string> => {
  const result = await authClient.signIn.social({
    provider: "planning-center",
    callbackURL: returnPath,
    errorCallbackURL: buildErrorCallbackUrl(returnPath),
    disableRedirect: true,
  });
  if (result.error) {
    throw new Error(result.error.message ?? START_SIGN_IN_ERROR);
  }
  const url = result.data?.url;
  if (url === undefined || url === "") {
    throw new Error(START_SIGN_IN_ERROR);
  }
  return url;
};

const WHITESPACE = /\s+/u;

const accountInitials = (account: DeviceAccount): string => {
  const source = account.name.trim() || account.email.trim();
  const [first = "", second = ""] = source.split(WHITESPACE);
  const initials =
    second === "" ? first.slice(0, 2) : `${first[0]}${second[0]}`;
  return initials.toUpperCase() || "?";
};

const RELATIVE_TIME_UNITS = [
  { unit: "year", ms: 365 * 24 * 60 * 60 * 1000 },
  { unit: "month", ms: 30 * 24 * 60 * 60 * 1000 },
  { unit: "week", ms: 7 * 24 * 60 * 60 * 1000 },
  { unit: "day", ms: 24 * 60 * 60 * 1000 },
  { unit: "hour", ms: 60 * 60 * 1000 },
] as const satisfies readonly {
  unit: Intl.RelativeTimeFormatUnit;
  ms: number;
}[];

const relativeTimeFormat = new Intl.RelativeTimeFormat("en", {
  numeric: "auto",
});

/** "today", "yesterday", "3 weeks ago": how recently this device used the account. */
const describeLastUsed = (lastActiveAt: string, now: number): string => {
  const elapsed = Math.max(0, now - Date.parse(lastActiveAt));
  for (const { unit, ms } of RELATIVE_TIME_UNITS) {
    if (elapsed >= ms) {
      return relativeTimeFormat.format(-Math.floor(elapsed / ms), unit);
    }
  }
  return "just now";
};

const firstName = (account: DeviceAccount): string | null => {
  const [first = ""] = account.name.trim().split(WHITESPACE);
  return first === "" ? null : first;
};

const DeviceAccountRow = ({
  account,
  now,
  pending,
  disabled,
  onSelect,
  onForget,
  onIntent,
}: {
  account: DeviceAccount;
  now: number;
  pending: boolean;
  disabled: boolean;
  onSelect: () => void;
  onForget: () => void;
  onIntent: () => void;
}) => {
  const displayName = account.name.trim() || account.email;
  const organization = account.organizationName ?? account.email;
  const lastUsed = describeLastUsed(account.lastActiveAt, now);
  return (
    <li className="group/account relative">
      <Item
        size="sm"
        className="pr-12"
        render={
          <button
            type="button"
            aria-label={`Continue as ${displayName}, ${organization}`}
            aria-busy={pending}
            disabled={disabled}
          />
        }
        onPointerEnter={onIntent}
        onFocus={onIntent}
        onClick={onSelect}
      >
        <ItemMedia>
          <Avatar size="lg">
            {account.image === null ? null : (
              <AvatarImage src={account.image} alt="" />
            )}
            <AvatarFallback>{accountInitials(account)}</AvatarFallback>
          </Avatar>
        </ItemMedia>
        <ItemContent className="min-w-0">
          <div className="flex w-full min-w-0 flex-col gap-0.5">
            <ItemTitle>{displayName}</ItemTitle>
            <p className="text-muted-foreground flex w-full min-w-0 items-center gap-1.5 text-xs">
              <span className="truncate">{organization}</span>
              <span aria-hidden className="opacity-50">
                ·
              </span>
              <span className="shrink-0">{lastUsed}</span>
            </p>
          </div>
        </ItemContent>
      </Item>
      {pending ? (
        <span className="pointer-events-none absolute top-1/2 right-4 -translate-y-1/2">
          <Spinner />
        </span>
      ) : null}
      {pending ? null : (
        <ChevronRight
          aria-hidden
          className="text-muted-foreground pointer-events-none absolute top-1/2 right-4 hidden size-4 -translate-y-1/2 transition-transform duration-150 ease-out [@media(hover:hover)]:block [@media(hover:hover)]:group-focus-within/account:opacity-0 [@media(hover:hover)]:group-hover/account:opacity-0"
        />
      )}
      {pending ? null : (
        <span className="absolute top-1/2 right-2 -translate-y-1/2 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-focus-within/account:opacity-100 [@media(hover:hover)]:group-hover/account:opacity-100">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Remove ${displayName} from this device`}
            disabled={disabled}
            onClick={onForget}
          >
            <X />
          </Button>
        </span>
      )}
    </li>
  );
};

const resumeDeviceAccount = async (userId: string): Promise<boolean> => {
  const result = await authClient.$fetch<{ resumed: boolean }>(
    "/device-accounts/resume",
    { method: "POST", body: { userId } }
  );
  return result.data?.resumed === true;
};

const forgetDeviceAccount = async (userId: string): Promise<void> => {
  // Best effort: the row is already hidden, and the session expires anyway.
  await authClient.$fetch("/device-accounts/forget", {
    method: "POST",
    body: { userId },
  });
};

export const AuthSignInCard = ({
  returnPath,
  initialError,
  errorCode,
  deviceAccounts,
  renderedAt,
}: {
  returnPath: string;
  initialError: string | null;
  /** The provider callback's `?error=` code, reported so failures show up in analytics. */
  errorCode: string | null;
  /** Accounts this browser can resume without Planning Center, listed during SSR. */
  deviceAccounts: readonly DeviceAccount[];
  renderedAt: number;
}) => {
  const [signInError, setSignInError] = useState(initialError ?? "");
  const [redirecting, setRedirecting] = useState(false);
  // Which quick-access account started the redirect; null for the main button.
  const [pendingUserId, setPendingUserId] = useState<string | null>(null);
  const [forgottenUserIds, setForgottenUserIds] = useState<readonly string[]>(
    []
  );
  const forgotten = new Set(forgottenUserIds);
  const rememberedAccounts = deviceAccounts.filter(
    (account) => !forgotten.has(account.userId)
  );
  const preparedRef = useRef<PreparedAuthorization | null>(null);
  const maskId = useId().replaceAll(":", "");
  const rocketRef = useRef<HTMLDivElement>(null);
  const replayCleanupRef = useRef<(() => void) | null>(null);

  // Same hover flourish as the sidebar brand mark; the page-load takeoff is
  // server-rendered so it plays with the first paint.
  const replayRocket = useCallback(() => {
    const rocket = rocketRef.current;
    if (rocket === null || !canPlayRocketHoverAnimation()) {
      return;
    }
    replayCleanupRef.current?.();
    replayCleanupRef.current = playRocketAnimation(rocket, "replay");
  }, []);

  useEffect(() => {
    if (errorCode !== null && errorCode !== "") {
      captureAnalytics("sign in failed", { error_code: errorCode });
    }
  }, [errorCode]);

  useEffect(
    () => () => {
      replayCleanupRef.current?.();
    },
    []
  );

  for (const origin of PLANNING_CENTER_ORIGINS) {
    preconnect(origin);
  }

  // Start the OAuth handshake on intent (hover, focus, press) so the
  // Planning Center URL is usually ready by the time the click lands.
  const prepareAuthorization = useCallback(async (): Promise<string> => {
    const cached = preparedRef.current;
    const prepared =
      cached !== null && Date.now() - cached.createdAt < PREPARED_URL_MAX_AGE_MS
        ? cached
        : { createdAt: Date.now(), url: requestAuthorizationUrl(returnPath) };
    preparedRef.current = prepared;

    try {
      return await prepared.url;
    } catch (error) {
      // Never reuse a failed handshake; the next attempt starts fresh.
      if (preparedRef.current === prepared) {
        preparedRef.current = null;
      }
      throw error;
    }
  }, [returnPath]);

  const warmAuthorization = useCallback(async () => {
    try {
      await prepareAuthorization();
    } catch {
      // Surfaced on click instead, where the visitor expects feedback.
    }
  }, [prepareAuthorization]);

  const handleSignIn = async (userId: string | null = null) => {
    if (redirecting) {
      return;
    }
    setSignInError("");
    setRedirecting(true);
    setPendingUserId(userId);
    captureAnalytics("sign in started");

    try {
      const url = await prepareAuthorization();
      // Keep the pending state until the browser leaves the page.
      window.location.assign(url);
    } catch (error) {
      captureAnalytics("sign in failed");
      setSignInError(
        error instanceof Error ? error.message : START_SIGN_IN_ERROR
      );
      setRedirecting(false);
      setPendingUserId(null);
    }
  };

  // A remembered account resumes its still-valid session here; only an expired
  // one goes back through Planning Center.
  const handleResume = async (userId: string) => {
    if (redirecting) {
      return;
    }
    setSignInError("");
    setRedirecting(true);
    setPendingUserId(userId);
    captureAnalytics("sign in started");
    try {
      const resumed = await resumeDeviceAccount(userId);
      if (resumed) {
        // The return path may be outside this router, such as `/admin`.
        window.location.assign(returnPath);
        return;
      }
    } catch {
      // Fall through to Planning Center, which always works.
    }
    setRedirecting(false);
    await handleSignIn(userId);
  };

  // Returning with the back button restores this page from the bfcache with
  // the pending state still set; reset it and discard the spent OAuth state.
  useEffect(() => {
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        preparedRef.current = null;
        setRedirecting(false);
        setPendingUserId(null);
      }
    };
    window.addEventListener("pageshow", handlePageShow);
    return () => {
      window.removeEventListener("pageshow", handlePageShow);
    };
  }, []);

  const hasRemembered = rememberedAccounts.length > 0;
  const [onlyAccount] = rememberedAccounts;
  const greetingName =
    rememberedAccounts.length === 1 && onlyAccount !== undefined
      ? firstName(onlyAccount)
      : null;
  let heading = "Sign in";
  if (greetingName !== null) {
    heading = `Welcome back, ${greetingName}`;
  } else if (hasRemembered) {
    heading = "Welcome back";
  }
  const mainButtonLabel =
    redirecting && pendingUserId === null
      ? "Opening Planning Center…"
      : "Continue with Planning Center";

  return (
    <main className="auth-backdrop flex min-h-svh items-center justify-center px-4 py-12">
      <div className="auth-stagger flex w-full max-w-sm flex-col items-center gap-6">
        <div className="flex items-center gap-2.5" onMouseEnter={replayRocket}>
          <span className="text-2xl tracking-tight">
            <strong className="font-bold">PCO</strong>Booster
          </span>
          <div
            ref={rocketRef}
            aria-hidden
            data-launching={redirecting ? "" : undefined}
            className={`auth-rocket size-10 ${ROCKET_ANIMATION.takeoff.className}`}
          >
            <BrandRocketLogo maskId={maskId} />
          </div>
        </div>

        <Card className="w-full">
          <CardContent>
            <div className="flex flex-col gap-6">
              <div className="flex flex-col gap-1.5 text-center">
                <h1 className="font-heading text-xl font-semibold tracking-tight">
                  {heading}
                </h1>
                <p className="text-muted-foreground text-pretty">
                  {hasRemembered
                    ? "Choose an account to keep planning."
                    : "Plan services and schedule your team with your Planning Center account."}
                </p>
              </div>

              {signInError === "" ? null : (
                <Alert variant="destructive" aria-live="polite">
                  <AlertDescription>{signInError}</AlertDescription>
                </Alert>
              )}

              {hasRemembered ? (
                <ul
                  className="bg-background/60 divide-border -mx-1 flex flex-col divide-y overflow-hidden rounded-2xl border"
                  aria-label="Accounts on this device"
                >
                  {rememberedAccounts.map((account) => (
                    <DeviceAccountRow
                      key={account.userId}
                      account={account}
                      now={renderedAt}
                      pending={pendingUserId === account.userId}
                      disabled={redirecting}
                      onIntent={() => {
                        void warmAuthorization();
                      }}
                      onSelect={() => {
                        void handleResume(account.userId);
                      }}
                      onForget={() => {
                        setForgottenUserIds((ids) => [...ids, account.userId]);
                        void forgetDeviceAccount(account.userId);
                      }}
                    />
                  ))}
                </ul>
              ) : null}

              {hasRemembered ? (
                <div className="text-muted-foreground flex items-center gap-3 text-xs">
                  <Separator className="flex-1" />
                  <span>or</span>
                  <Separator className="flex-1" />
                </div>
              ) : null}

              <Button
                type="button"
                size="lg"
                className="w-full"
                aria-busy={redirecting}
                disabled={redirecting}
                onPointerEnter={() => {
                  replayRocket();
                  void warmAuthorization();
                }}
                onFocus={() => {
                  void warmAuthorization();
                }}
                onClick={() => {
                  void handleSignIn();
                }}
              >
                {redirecting && pendingUserId === null ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <PlanningCenterServicesIcon
                    data-icon="inline-start"
                    className="size-5"
                  />
                )}
                {mainButtonLabel}
              </Button>
            </div>
          </CardContent>
        </Card>

        <p className="text-muted-foreground max-w-xs text-center text-xs text-pretty">
          {hasRemembered
            ? "Accounts you switched away from stay signed in on this browser. Remove one to sign it out."
            : "You’ll sign in on Planning Center, then come right back here. PCOBooster only uses your Services and People access."}
        </p>
      </div>
    </main>
  );
};
