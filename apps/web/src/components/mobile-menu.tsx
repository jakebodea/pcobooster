import { useRender } from "@base-ui/react/use-render";
import {
  LaptopIcon,
  Logout01Icon,
  UserSwitchIcon,
  Moon02Icon,
  Sun01Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { isNonEmptyString } from "@pcobooster/planning-center-models/json";
import {
  MobileMenuIcon,
  MobileMenuItem,
  MobileMenuOverlay,
  useMobileMenu,
} from "@pcobooster/ui/mobile-menu";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useRouter } from "@tanstack/react-router";
import type { ComponentProps, ReactElement, ReactNode } from "react";
import { useEffect, useId } from "react";

import { SidebarNavIcon } from "@/components/sidebar-nav-icon";
import { useTheme } from "@/components/theme-provider";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { signOutLabel, useAccountPanel } from "@/hooks/use-account-panel";
import { usePlanRoute } from "@/hooks/use-plan-route";
import { getAppSection, getPlanViewLabel, planViews } from "@/lib/app-routes";
import { chordChartsFeatureQueryOptions } from "@/lib/chord-charts-route";
import { getInitials } from "@/lib/format/initials";
import { peopleFeatureQueryOptions } from "@/lib/people-route";
import { cn } from "@/lib/utils";

const MOBILE_MENU_ID = "mobile-menu";

const themeOptions = [
  { value: "light", label: "Light", icon: Sun01Icon },
  { value: "dark", label: "Dark", icon: Moon02Icon },
  { value: "system", label: "System", icon: LaptopIcon },
] as const;

/** A large menu link, set like the marketing menu; `nested` marks plan views. */
const MenuLink = ({
  link,
  label,
  active,
  nested = false,
}: {
  /** A router `<Link>`; the entry renders through it. */
  link: ReactElement;
  label: string;
  active: boolean;
  nested?: boolean;
}) =>
  useRender({
    render: link,
    props: {
      "aria-current": active ? "page" : undefined,
      className: cn(
        "block tracking-tight outline-none focus-visible:underline",
        nested ? "py-1.5 pl-5 text-2xl" : "py-2.5 text-4xl",
        active ? "text-foreground" : "text-muted-foreground"
      ),
      children: label,
    },
  });

const MenuNav = () => {
  const pathname = useLocation({ select: (location) => location.pathname });
  const section = getAppSection(pathname);
  const planRoute = usePlanRoute();
  const peopleEnabled =
    useQuery(peopleFeatureQueryOptions).data?.enabled ?? false;
  const songsEnabled =
    useQuery(chordChartsFeatureQueryOptions).data?.enabled ?? false;
  const entries: {
    key: string;
    link: ReactElement;
    label: string;
    active: boolean;
    nested?: boolean;
  }[] = [
    {
      key: "services",
      link: <Link to="/services" />,
      label: "Services",
      active: pathname === "/services",
    },
  ];
  if (planRoute !== null) {
    for (const view of planViews) {
      entries.push({
        key: view,
        // Keeps the selected slot across views.
        link: (
          <Link
            to="/services/$serviceTypeId/plans/$planId/$view"
            params={{ ...planRoute, view }}
            search
            replace
          />
        ),
        label: getPlanViewLabel(view),
        active: view === planRoute.view,
        nested: true,
      });
    }
  }
  if (peopleEnabled) {
    entries.push({
      key: "people",
      link: <Link to="/people" />,
      label: "People",
      active: section === "people",
    });
  }
  if (songsEnabled) {
    entries.push({
      key: "songs",
      link: <Link to="/songs" />,
      label: "Songs",
      active: section === "songs",
    });
  }

  return (
    <ul>
      {entries.map((entry, index) => (
        <MobileMenuItem key={entry.key} index={index}>
          <MenuLink
            link={entry.link}
            label={entry.label}
            active={entry.active}
            nested={entry.nested}
          />
        </MobileMenuItem>
      ))}
    </ul>
  );
};

/** A quiet account row; `render` is a bare `<button />`. */
const AccountRow = ({
  render,
  active = false,
  children,
  ...props
}: {
  render: ReactElement;
  active?: boolean;
  children: ReactNode;
} & Pick<ComponentProps<"button">, "disabled" | "onClick">) =>
  useRender({
    render,
    props: {
      ...props,
      className: cn(
        "focus-visible:ring-ring/50 flex h-11 w-full items-center gap-3 rounded-lg text-left text-base outline-none focus-visible:ring-2 disabled:opacity-50",
        active ? "text-foreground" : "text-muted-foreground"
      ),
      children,
    },
  });

const MenuAccount = ({
  onAccountSwitched,
}: {
  onAccountSwitched: () => void;
}) => {
  const { setTheme, theme } = useTheme();
  const {
    data,
    demo,
    summary,
    panelError,
    switchingAccountId,
    isSigningOut,
    selectAccount,
    signOut,
    switchAccount,
  } = useAccountPanel({ onAccountSwitched });
  const accounts = data?.accounts ?? [];
  const themeOption =
    themeOptions.find((option) => option.value === theme) ?? themeOptions[2];
  const busy = isSigningOut || Boolean(switchingAccountId);
  const themeSelectId = useId();

  return (
    <div className="flex flex-col gap-1">
      {accounts.length > 1
        ? accounts.map((account) => {
            const isSelected = account.id === data?.selectedAccountId;
            const orgName =
              account.identity?.organizationName ?? "Unknown organization";
            return (
              <AccountRow
                key={account.id}
                render={<button type="button" aria-label={orgName} />}
                active={isSelected}
                disabled={busy}
                onClick={() => {
                  void selectAccount(account.id);
                }}
              >
                <span className="min-w-0 flex-1 truncate">{orgName}</span>
                {switchingAccountId === account.id ? <Spinner /> : null}
                {isSelected ? <SidebarNavIcon icon={Tick02Icon} /> : null}
              </AccountRow>
            );
          })
        : null}
      <div className="text-muted-foreground flex h-11 items-center gap-3 text-base">
        <SidebarNavIcon icon={themeOption.icon} />
        <label htmlFor={themeSelectId} className="flex-1">
          Theme
        </label>
        <NativeSelect
          id={themeSelectId}
          value={themeOption.value}
          onChange={(event) => {
            const option = themeOptions.find(
              (candidate) => candidate.value === event.target.value
            );
            if (option) {
              setTheme(option.value);
            }
          }}
        >
          {themeOptions.map((option) => (
            <NativeSelectOption key={option.value} value={option.value}>
              {option.label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
      {demo ? null : (
        <AccountRow
          render={<button type="button" aria-label="Switch account" />}
          disabled={busy}
          onClick={() => {
            void switchAccount();
          }}
        >
          <SidebarNavIcon icon={UserSwitchIcon} />
          Switch account
        </AccountRow>
      )}
      <AccountRow
        render={
          <button type="button" aria-label={signOutLabel(demo, isSigningOut)} />
        }
        disabled={busy}
        onClick={() => {
          void signOut();
        }}
      >
        {isSigningOut ? <Spinner /> : <SidebarNavIcon icon={Logout01Icon} />}
        {signOutLabel(demo, isSigningOut)}
      </AccountRow>
      {panelError ? (
        <p className="text-destructive text-sm">{panelError}</p>
      ) : null}
      <div className="border-border/50 mt-3 flex items-center gap-3 border-t pt-4">
        <Avatar className="size-9">
          {isNonEmptyString(summary.image) ? (
            <AvatarImage src={summary.image} alt="" />
          ) : null}
          <AvatarFallback>
            {getInitials(summary.avatarName ?? "Account")}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            {data?.session.name ?? summary.avatarName ?? "Account"}
          </p>
          <p className="text-muted-foreground truncate text-xs">
            {demo ? "Read-only demo" : summary.organizationName}
          </p>
        </div>
      </div>
    </div>
  );
};

/**
 * The phone header: a pinned bar with the menu button on the right and the
 * shared full-screen menu (`@pcobooster/ui/mobile-menu`) beneath it. The bar
 * blurs content scrolling under it; the header itself stays filter-free so the
 * fixed overlay is not trapped. `className` places the header (for example,
 * `-mx-4` inside padded pages).
 */
export const MobileHeader = ({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) => {
  const menu = useMobileMenu();
  const router = useRouter();
  const { handleClose } = menu;

  useEffect(
    () => router.subscribe("onBeforeNavigate", handleClose),
    [router, handleClose]
  );

  return (
    <header
      data-open={menu.open ? "" : undefined}
      className={cn(
        "group/menu pt-safe sticky top-0 z-30 shrink-0 md:hidden",
        className
      )}
    >
      {/*
       * The blur sits on an absolute layer, not the sticky header: Safari 26
       * tints its bars from sticky elements' own backgrounds, while this layer
       * lets the header show through the status bar like the page beneath.
       */}
      <div
        aria-hidden
        className="bg-background/80 absolute inset-0 backdrop-blur-xl group-data-open/menu:hidden"
      />
      <div className="relative z-10 flex h-14 items-center gap-1 px-4">
        <div className="flex min-w-0 flex-1 items-center gap-1 group-data-open/menu:invisible">
          {children}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-lg"
          aria-label={menu.open ? "Close menu" : "Open menu"}
          aria-expanded={menu.open}
          aria-controls={MOBILE_MENU_ID}
          className="-mr-2 shrink-0"
          onClick={menu.handleToggle}
        >
          <MobileMenuIcon open={menu.open} />
        </Button>
      </div>
      <MobileMenuOverlay
        id={MOBILE_MENU_ID}
        open={menu.open}
        className="pt-safe"
      >
        <nav
          aria-label="Mobile navigation"
          className="pb-safe-4 flex h-full flex-col justify-between gap-8 overflow-y-auto overscroll-contain px-4 pt-18"
        >
          <MenuNav />
          <MenuAccount onAccountSwitched={menu.handleClose} />
        </nav>
      </MobileMenuOverlay>
    </header>
  );
};
