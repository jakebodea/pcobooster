import {
  ArrowDown01Icon,
  Calendar04Icon,
  Clock01Icon,
  KeyboardIcon,
  LaptopIcon,
  Layout3ColumnIcon,
  ListMusicIcon,
  Logout01Icon,
  UserSwitchIcon,
  Moon02Icon,
  MusicNote03Icon,
  Settings02Icon,
  Sun01Icon,
  Tick02Icon,
  UserAdd01Icon,
  UsersIcon,
} from "@hugeicons/core-free-icons";
import type { PlanningCenterAccountsResponse } from "@pcobooster/contracts/accounts";
import { isNonEmptyString } from "@pcobooster/planning-center-models/json";
import { useHotkey } from "@tanstack/react-hotkeys";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { Check, ChevronDown, ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useState } from "react";

import { HotkeyChord } from "@/components/hotkey-chord";
import { MobileHeader } from "@/components/mobile-menu";
import { SidebarBrandMark } from "@/components/sidebar-brand-mark";
import { SidebarChromeTrigger } from "@/components/sidebar-chrome-trigger";
import { SidebarFeedback } from "@/components/sidebar-feedback";
import { SidebarNavIcon } from "@/components/sidebar-nav-icon";
import type { SidebarTabGroupItem } from "@/components/sidebar-tab-group";
import { SidebarTabGroup } from "@/components/sidebar-tab-group";
import { SidebarToggleHotkey } from "@/components/sidebar-toggle-hotkey";
import { useTheme } from "@/components/theme-provider";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { HoverLabel } from "@/components/ui/hover-card";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  useSidebar,
} from "@/components/ui/sidebar";
import { Spinner } from "@/components/ui/spinner";
import {
  signOutLabel,
  useAccountPanel,
  useAccountsQuery,
} from "@/hooks/use-account-panel";
import { useBrowserStorage } from "@/hooks/use-browser-storage";
import { usePlanRoute } from "@/hooks/use-plan-route";
import { APP_SHORTCUTS, SHORTCUTS_PALETTE_HOTKEY } from "@/lib/app-hotkeys";
import type { PlanView } from "@/lib/app-routes";
import {
  getAppSection,
  getAppSectionLabel,
  getPlanViewLabel,
  parseDetailRoute,
  planViews,
} from "@/lib/app-routes";
import { presentationMode } from "@/lib/build-settings";
import { chordChartsFeatureQueryOptions } from "@/lib/chord-charts-route";
import { peopleFeatureQueryOptions } from "@/lib/people-route";
import { cn } from "@/lib/utils";

const SIDEBAR_OPEN_STORAGE_KEY = "pcobooster:sidebar-open";
const APP_CHROME_ROW = "flex h-12 shrink-0 items-center gap-2";
const APP_CHROME_HEADER_CLASS = cn(APP_CHROME_ROW, "px-2");

const initialsFromName = (name: string | null | undefined): string => {
  if (!isNonEmptyString(name)) {
    return "WA";
  }
  const parts = name.trim().split(/\s+/u).filter(Boolean);
  if (parts.length === 0) {
    return "WA";
  }
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
};

const themeOptions = [
  { value: "light", label: "Light", icon: Sun01Icon },
  { value: "dark", label: "Dark", icon: Moon02Icon },
  { value: "system", label: "System", icon: LaptopIcon },
] as const;

type ServicesSidebarKey = "services" | PlanView;

const AppInsetChromeHeader = ({ children }: { children: ReactNode }) => {
  const { open, isMobile } = useSidebar();
  const alignWithPageContent = open && !isMobile;

  return (
    <header
      className={cn(
        APP_CHROME_ROW,
        "border-border/50 border-b max-md:hidden",
        alignWithPageContent ? "px-3 sm:px-4" : "px-2"
      )}
    >
      {children}
    </header>
  );
};

const usePathname = (): string =>
  useLocation({ select: (location) => location.pathname });

const AppTopBar = () => {
  const navigate = useNavigate();
  const pathname = usePathname();
  const planRoute = usePlanRoute();
  const hasPlan = planRoute !== null;
  const planView = planRoute?.view ?? "assign";
  const planViewLabel = getPlanViewLabel(planView);
  const detail = parseDetailRoute(pathname);
  const pageLabel = getAppSectionLabel(getAppSection(pathname));

  return (
    <div className="flex w-full min-w-0 items-center gap-2 sm:gap-3">
      <Breadcrumb className="shrink-0">
        <BreadcrumbList>
          {detail ? (
            <>
              <BreadcrumbItem>
                <BreadcrumbLink render={<Link to={detail.parentHref} />}>
                  {detail.parentLabel}
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>{detail.label}</BreadcrumbPage>
              </BreadcrumbItem>
            </>
          ) : (
            <>
              <BreadcrumbItem>
                {hasPlan ? (
                  <BreadcrumbLink render={<Link to="/services" />}>
                    Services
                  </BreadcrumbLink>
                ) : (
                  <BreadcrumbPage>{pageLabel}</BreadcrumbPage>
                )}
              </BreadcrumbItem>
              {hasPlan ? (
                <>
                  <BreadcrumbSeparator />
                  <BreadcrumbItem>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            variant="ghost"
                            size="xs"
                            aria-label={`Change view from ${planViewLabel}`}
                          />
                        }
                      >
                        <span>{planViewLabel}</span>
                        <ChevronDown
                          className="text-muted-foreground size-3.5"
                          aria-hidden
                        />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="w-36">
                        {planViews.map((view) => (
                          <DropdownMenuItem
                            key={view}
                            onSelect={() => {
                              if (planRoute === null) {
                                return;
                              }
                              void navigate({
                                to: "/services/$serviceTypeId/plans/$planId/$view",
                                params: { ...planRoute, view },
                                search: true,
                                replace: true,
                              });
                            }}
                          >
                            <span>{getPlanViewLabel(view)}</span>
                            {planView === view ? (
                              <Check className="ml-auto size-4" aria-hidden />
                            ) : null}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </BreadcrumbItem>
                </>
              ) : null}
            </>
          )}
        </BreadcrumbList>
      </Breadcrumb>
    </div>
  );
};

const AccountSwitcher = ({
  data,
  loading,
  switchingAccountId,
  isSigningOut,
  onSelectAccount,
}: {
  data: PlanningCenterAccountsResponse | null;
  loading: boolean;
  switchingAccountId: string | null;
  isSigningOut: boolean;
  onSelectAccount: (accountId: string) => Promise<void>;
}) =>
  (loading && !data) || (data !== null && data.accounts.length > 1) ? (
    <>
      <DropdownMenuSeparator inset />
      {loading && !data ? (
        <DropdownMenuItem disabled>Loading…</DropdownMenuItem>
      ) : (
        data?.accounts.map((account) => {
          const isSelected = account.id === data.selectedAccountId;
          const orgName =
            account.identity?.organizationName ?? "Unknown organization";
          return (
            <DropdownMenuItem
              key={account.id}
              disabled={Boolean(switchingAccountId) || isSigningOut}
              onSelect={(event) => {
                event.preventDefault();
                void onSelectAccount(account.id);
              }}
            >
              <span className="min-w-0 flex-1 truncate">{orgName}</span>
              {switchingAccountId === account.id ? (
                <Spinner />
              ) : (
                <SidebarNavIcon
                  icon={Tick02Icon}
                  className={cn(isSelected ? "opacity-80" : "invisible")}
                />
              )}
            </DropdownMenuItem>
          );
        })
      )}
    </>
  ) : null;

const SidebarAccountPanel = ({
  onOpenShortcuts,
}: {
  onOpenShortcuts: () => void;
}) => {
  const { setTheme, theme } = useTheme();
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const {
    data,
    loading,
    demo,
    summary: triggerSummary,
    panelError,
    switchingAccountId,
    isSigningOut,
    selectAccount,
    signOut,
    switchAccount,
  } = useAccountPanel({
    onAccountSwitched: () => {
      setAccountMenuOpen(false);
    },
  });

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu
          open={accountMenuOpen}
          onOpenChange={(open) => {
            setAccountMenuOpen(open);
          }}
        >
          <DropdownMenuTrigger render={<SidebarMenuButton />}>
            <Avatar size="sm">
              {isNonEmptyString(triggerSummary.image) ? (
                <AvatarImage
                  src={triggerSummary.image}
                  alt={triggerSummary.avatarName ?? "User"}
                />
              ) : null}
              <AvatarFallback>
                {initialsFromName(triggerSummary.avatarName)}
              </AvatarFallback>
            </Avatar>
            <span className="flex-1 truncate text-left text-sm font-medium">
              {triggerSummary.organizationName}
            </span>
            <SidebarNavIcon
              icon={ArrowDown01Icon}
              className={cn(
                "text-muted-foreground ml-auto size-3.5 transition-transform group-data-[collapsible=icon]:hidden",
                accountMenuOpen ? "rotate-180" : null
              )}
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side="bottom"
            align="start"
            className="z-[80] w-[var(--radix-dropdown-menu-trigger-width)] max-w-none min-w-[14rem]"
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel className="cursor-default">
                <span className="text-foreground block truncate text-sm font-semibold">
                  {data?.session.name ?? "Account"}
                </span>
                <span className="text-muted-foreground mt-1 block truncate text-xs">
                  {demo ? "Read-only demo" : (data?.session.email ?? "")}
                </span>
              </DropdownMenuLabel>

              <AccountSwitcher
                data={data}
                loading={loading}
                switchingAccountId={switchingAccountId}
                isSigningOut={isSigningOut}
                onSelectAccount={selectAccount}
              />
            </DropdownMenuGroup>

            <DropdownMenuSeparator inset />

            <DropdownMenuGroup>
              <DropdownMenuLabel>Appearance</DropdownMenuLabel>
              {themeOptions.map((option) => {
                const selected = theme === option.value;
                return (
                  <DropdownMenuItem
                    key={option.value}
                    onSelect={() => {
                      setTheme(option.value);
                    }}
                  >
                    <SidebarNavIcon
                      icon={option.icon}
                      className="text-muted-foreground"
                    />
                    <span>{option.label}</span>
                    <SidebarNavIcon
                      icon={Tick02Icon}
                      className={cn(
                        selected ? "ml-auto opacity-80" : "invisible ml-auto"
                      )}
                    />
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuGroup>

            <DropdownMenuSeparator inset />

            <DropdownMenuItem
              onSelect={() => {
                onOpenShortcuts();
              }}
            >
              <SidebarNavIcon
                icon={KeyboardIcon}
                className="text-muted-foreground"
              />
              <span className="flex-1">Keyboard shortcuts</span>
              <HotkeyChord
                id="acct-menu-shortcuts"
                binding={SHORTCUTS_PALETTE_HOTKEY}
                className="ml-2 shrink-0"
              />
            </DropdownMenuItem>

            {panelError ? (
              <p className="text-destructive mx-2 my-1.5 text-xs leading-snug">
                {panelError}
              </p>
            ) : null}

            <DropdownMenuSeparator inset />

            {demo ? null : (
              <DropdownMenuItem
                disabled={isSigningOut || Boolean(switchingAccountId)}
                onSelect={() => {
                  void switchAccount();
                }}
              >
                <SidebarNavIcon icon={UserSwitchIcon} />
                Switch account
              </DropdownMenuItem>
            )}

            <DropdownMenuItem
              variant="destructive"
              disabled={isSigningOut || Boolean(switchingAccountId)}
              onSelect={() => {
                void signOut();
              }}
            >
              {isSigningOut ? (
                <Spinner />
              ) : (
                <SidebarNavIcon icon={Logout01Icon} />
              )}
              {signOutLabel(demo, isSigningOut)}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
};

const servicesRootItem: SidebarTabGroupItem<ServicesSidebarKey> = {
  key: "services",
  label: "Services",
  link: <Link to="/services" />,
  icon: Calendar04Icon,
};

const planViewIcons: Record<PlanView, SidebarTabGroupItem["icon"]> = {
  assign: UserAdd01Icon,
  lineup: Layout3ColumnIcon,
  plan: ListMusicIcon,
  times: Clock01Icon,
};

const ServicesSidebarMenuItem = () => {
  const pathname = usePathname();
  const planRoute = usePlanRoute();
  const servicesViewItems: SidebarTabGroupItem<ServicesSidebarKey>[] =
    planRoute === null
      ? [servicesRootItem]
      : [
          servicesRootItem,
          ...planViews.map((view) => ({
            key: view,
            label: getPlanViewLabel(view),
            // Keeps the selected slot across views.
            link: (
              <Link
                to="/services/$serviceTypeId/plans/$planId/$view"
                params={{ ...planRoute, view }}
                search
              />
            ),
            icon: planViewIcons[view],
          })),
        ];
  let servicesActiveKey: ServicesSidebarKey | null = null;
  if (pathname === "/services") {
    servicesActiveKey = "services";
  } else if (planRoute !== null) {
    servicesActiveKey = planRoute.view;
  }

  return (
    <SidebarTabGroup
      activeKey={servicesActiveKey}
      fallbackItem={servicesRootItem}
      isGrouped={planRoute !== null}
      items={servicesViewItems}
    />
  );
};

const useNavFeatures = () => {
  const peopleFeatureQuery = useQuery(peopleFeatureQueryOptions);
  const chordChartsFeatureQuery = useQuery(chordChartsFeatureQueryOptions);
  return {
    peopleNavEnabled: peopleFeatureQuery.data?.enabled ?? false,
    songsNavEnabled: chordChartsFeatureQuery.data?.enabled ?? false,
  };
};

const AppSidebar = ({
  peopleNavEnabled,
  songsNavEnabled,
}: {
  peopleNavEnabled: boolean;
  songsNavEnabled: boolean;
}) => {
  const pathname = usePathname();
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  useHotkey(
    SHORTCUTS_PALETTE_HOTKEY,
    () => {
      setShortcutsOpen(true);
    },
    { ignoreInputs: true }
  );

  return (
    <>
      <Sidebar variant="inset" collapsible="offcanvas">
        <SidebarHeader size="chrome">
          <div className={APP_CHROME_HEADER_CLASS}>
            <SidebarChromeTrigger when="sidebar" />
            <SidebarBrandMark />
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <ServicesSidebarMenuItem />
                </SidebarMenuItem>
                {peopleNavEnabled ? (
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      render={<Link to="/people" />}
                      isActive={pathname.startsWith("/people")}
                      tooltip="People"
                    >
                      <SidebarNavIcon icon={UsersIcon} />
                      <span>People</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ) : null}
                {songsNavEnabled ? (
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      render={<Link to="/songs" />}
                      isActive={pathname.startsWith("/songs")}
                      tooltip="Songs"
                    >
                      <SidebarNavIcon icon={MusicNote03Icon} />
                      <span>Songs</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ) : null}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <div className="border-sidebar-border/50 flex flex-col gap-2 border-t pt-2">
            <SidebarMenu>
              <SidebarFeedback />
              <SidebarMenuItem>
                <SidebarMenuButton
                  type="button"
                  tooltip="Shortcuts"
                  onClick={() => {
                    setShortcutsOpen(true);
                  }}
                >
                  <SidebarNavIcon icon={Settings02Icon} />
                  <span>Shortcuts</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
            <SidebarAccountPanel
              onOpenShortcuts={() => {
                setShortcutsOpen(true);
              }}
            />
          </div>
        </SidebarFooter>
      </Sidebar>
      <Dialog open={shortcutsOpen} onOpenChange={setShortcutsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Shortcuts</DialogTitle>
            <DialogDescription>
              Keyboard shortcuts available in pcobooster.com.
            </DialogDescription>
          </DialogHeader>
          <dl className="grid gap-3 text-sm">
            {APP_SHORTCUTS.map((shortcut) => (
              <div
                key={shortcut.id}
                className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1"
              >
                <dt className="text-muted-foreground">{shortcut.label}</dt>
                <dd>
                  <HotkeyChord id={shortcut.id} binding={shortcut.binding} />
                </dd>
              </div>
            ))}
          </dl>
        </DialogContent>
      </Dialog>
    </>
  );
};

/** Visitors on a demo link need to know why nothing they change sticks. */
const DemoBadge = () => {
  const { data } = useAccountsQuery();
  if (data?.demo !== true) {
    return null;
  }
  return (
    <HoverLabel
      label="Explore freely. Changes aren’t saved."
      side="bottom"
      align="end"
      sideOffset={8}
      render={<Badge variant="secondary" className="ml-auto" />}
    >
      Read-only demo
    </HoverLabel>
  );
};

const PresentationModeBadge = () => (
  <span className="bg-status-scheduled/10 text-status-scheduled ml-auto shrink-0 rounded-md px-2 py-1 text-xs font-medium">
    <span className="md:hidden">Presenting</span>
    <span className="max-md:hidden">Presentation mode</span>
  </span>
);

/**
 * Phone header for sections and detail pages. Plan workspaces render their own
 * header with the plan title, so this stays out of the way there.
 */
const MobileChromeHeader = () => {
  const pathname = usePathname();
  const planRoute = usePlanRoute();
  if (planRoute !== null) {
    return null;
  }
  const detail = parseDetailRoute(pathname);

  return (
    <MobileHeader>
      {detail ? (
        <Link
          to={detail.parentHref}
          className={buttonVariants({
            variant: "ghost",
            size: "lg",
            className: "-ml-2 gap-0.5 pl-1.5 text-base",
          })}
        >
          <ChevronLeft className="size-5" aria-hidden />
          {detail.parentLabel}
        </Link>
      ) : (
        <p className="text-lg font-semibold tracking-tight">
          {getAppSectionLabel(getAppSection(pathname))}
        </p>
      )}
      <DemoBadge />
      {presentationMode ? <PresentationModeBadge /> : null}
    </MobileHeader>
  );
};

/** Navigation chrome around every signed-in product page. */
export const AppShell = ({ children }: { children: ReactNode }): ReactNode => {
  const [storedOpen, setStoredOpen] = useBrowserStorage(
    SIDEBAR_OPEN_STORAGE_KEY
  );
  const sidebarOpen = storedOpen !== "false";
  const { peopleNavEnabled, songsNavEnabled } = useNavFeatures();

  const handleSidebarOpenChange = useCallback(
    (nextOpen: boolean) => {
      setStoredOpen(String(nextOpen));
    },
    [setStoredOpen]
  );

  return (
    <SidebarProvider
      open={sidebarOpen}
      onOpenChange={handleSidebarOpenChange}
      className="min-h-dvh md:h-dvh md:min-h-0 md:overflow-hidden"
    >
      <SidebarToggleHotkey />
      <AppSidebar
        peopleNavEnabled={peopleNavEnabled}
        songsNavEnabled={songsNavEnabled}
      />
      <SidebarInset className="md:min-h-0 md:overflow-hidden">
        <AppInsetChromeHeader>
          <SidebarChromeTrigger when="inset" />
          <AppTopBar />
          <DemoBadge />
          {presentationMode ? <PresentationModeBadge /> : null}
        </AppInsetChromeHeader>
        <MobileChromeHeader />
        <div className="flex flex-1 flex-col md:min-h-0">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
};
