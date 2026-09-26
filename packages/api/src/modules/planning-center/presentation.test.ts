import { PlanningCenterNetworkError } from "@pcobooster/api/planning-center/network-error";
import type { PlanningCenterCatalogService } from "@pcobooster/api/planning-center/services/catalog-service";
import type { PlanningCenterPeopleService } from "@pcobooster/api/planning-center/services/people-service";
import { PlanningCenterReadCache } from "@pcobooster/api/planning-center/services/read-cache";
import type {
  Blockout,
  TeamPositionGroup,
} from "@pcobooster/planning-center-models/types";
import {
  getPresentationSeed,
  getPresentationCacheScope,
  isPresentationMode,
} from "@pcobooster/presentation-mode";
import type { PresentationEnvironment } from "@pcobooster/presentation-mode";
import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CandidateDetailsBatch } from "./get-candidate-details";
import type { PlanWindowHistoryBatch } from "./get-plan-window-history";
import type { PositionCandidatesResult } from "./get-position-candidates";
import type {
  PeopleDashboardRoster,
  PeopleDashboardPerson,
  PeopleDashboardPersonDetail,
} from "./people-dashboard-types";
import {
  getPresentationIdentityMapper,
  presentBlockouts,
  presentDashboardRoster,
  presentDashboardPerson,
  presentCandidateDetails,
  presentPlanWindowHistory,
  presentPositionCandidates,
  presentTeamPositions,
  presentationIdentity,
} from "./presentation";
import { searchPeople } from "./search-people";

let environment: PresentationEnvironment = {};
const setEnvironment = (key: keyof PresentationEnvironment, value?: string) => {
  environment = { ...environment, [key]: value };
};

const createDependencies = () => {
  const catalog = {
    getOrganization: vi
      .fn<PlanningCenterCatalogService["getOrganization"]>()
      .mockReturnValue(
        Effect.succeed({
          id: "org-1",
          type: "Organization",
          attributes: { name: "My Organization" },
        })
      ),
  };
  const people = {
    getCacheScope: () => "presentation-test",
    getAllPeople: vi.fn<PlanningCenterPeopleService["getAllPeople"]>(),
    searchPeopleByName:
      vi.fn<PlanningCenterPeopleService["searchPeopleByName"]>(),
  };
  const presentation = {
    catalog,
    people,
    getPresentationSeed: () => getPresentationSeed(environment),
    isPresentationMode: () => isPresentationMode(environment),
    organizationIds: new PlanningCenterReadCache<string>(),
  };
  const search = {
    people,
    getIdentityMapper: getPresentationIdentityMapper(presentation),
  };
  return { catalog, people, presentation, search };
};
let dependencies = createDependencies();

const blockout: Blockout = {
  id: "blockout-1",
  reason: "Private Reason",
  description: "Private Description",
  startsAt: new Date("2026-09-16"),
  endsAt: new Date("2026-09-17"),
  share: true,
  timeZone: "America/Los_Angeles",
};
const groups: TeamPositionGroup[] = [
  {
    teamId: "band",
    teamName: "Band",
    positions: [
      {
        id: "vocals",
        name: "Vocals",
        teamId: "band",
        filledPeople: [
          {
            id: "plan-person-1",
            planPersonId: "plan-person-1",
            personId: "person-1",
            name: "Private Name",
            status: "confirmed",
            rawStatus: "C",
            photoThumbnailUrl: "https://private/photo",
          },
        ],
      },
    ],
  },
];
const people: PositionCandidatesResult = {
  generatedAt: "2026-09-16",
  timeZone: "America/Los_Angeles",
  match: { planId: "plan-1", teamId: "band", selectedPositionName: "Vocals" },
  candidates: [
    {
      id: "person-1",
      firstName: "Private",
      lastName: "Name",
      fullName: "Private Name",
      photoUrl: "https://private/full",
      photoThumbnailUrl: "https://private/photo",
      archived: false,
      selectedPlanRosterLabels: ["Band - Vocals"],
      selectedPlanSlot: {
        planPersonId: "plan-person-1",
        status: "declined",
        declineReason: "Private Reason",
      },
    },
  ],
};
const windowHistory: PlanWindowHistoryBatch = {
  generatedAt: "2026-09-16",
  loadedPlanCount: 1,
  plans: [],
  planTimes: [],
  people: [
    {
      personId: "person-1",
      rows: [
        {
          id: "plan-person-1",
          planId: "plan-1",
          teamId: "band",
          teamPositionName: "Vocals",
          status: "D",
          createdAt: "2026-09-01",
          timeIds: [],
          serviceTimeIds: [],
          declineReason: "Private Reason",
        },
      ],
    },
  ],
  deferredPlans: [],
  deferredServiceTypeIds: [],
  requestBudget: {
    limit: 40,
    planningCenterRequests: 1,
    planRangeRequests: 0,
    rosterRequests: 1,
  },
};
const candidateDetails: CandidateDetailsBatch = {
  generatedAt: "2026-09-16",
  people: [
    {
      personId: "person-1",
      isBlockedForDate: true,
      history: {
        serviceHistory: [],
        selectedPlanAssignments: [
          {
            source: "schedule",
            id: "schedule-1",
            planId: "plan-1",
            teamId: "band",
            teamName: "Band",
            teamPositionName: "Vocals",
            status: "D",
            planPersonId: "plan-person-1",
            declineReason: "Private Reason",
          },
        ],
      },
    },
  ],
  deferredPersonIds: [],
  blockoutProgress: [],
  requestBudget: {
    limit: 36,
    planningCenterRequests: 1,
    firstReadRequests: 1,
    blockoutDateRequests: 0,
    planTimeRequests: 0,
  },
};
const dashboardPerson: PeopleDashboardPerson = {
  id: "person-1",
  name: "Private Name",
  initials: "PN",
  photoThumbnailUrl: "https://private/photo",
  teams: ["Band"],
  roles: "Vocals",
  status: "Scheduled",
  load: "normal",
  lastServed: "Sep 9",
  nextScheduled: "Sep 23",
  monthCount: 1,
  thirtyDayCount: 1,
  ninetyDayCount: 3,
  upcomingCount: 1,
  streak: "1 this month",
  highlight: "Healthy cadence",
  monthDays: [],
};
const dashboard: PeopleDashboardRoster = {
  generatedAt: "2026-09-16",
  people: [
    {
      id: dashboardPerson.id,
      name: dashboardPerson.name,
      initials: dashboardPerson.initials,
      photoThumbnailUrl: dashboardPerson.photoThumbnailUrl,
      teams: dashboardPerson.teams,
    },
  ],
  teams: [],
  ledTeamIds: [],
  month: {
    year: 2026,
    monthIndex: 8,
    label: "September",
    daysInMonth: 30,
    startsOnWeekday: 2,
  },
};
const detail: PeopleDashboardPersonDetail = {
  generatedAt: "2026-09-16",
  month: dashboard.month,
  previousMonth: "2026-08",
  nextMonth: "2026-10",
  person: dashboardPerson,
  trend: [],
  requestBudget: {
    limit: 36,
    planningCenterRequests: 4,
    unresolvedRehearsalTimes: 0,
  },
};

const setupPresentationEnvironment = () => {
  environment = {
    NODE_ENV: "development",
    PRESENTATION_MODE: "1",
    PRESENTATION_SEED: "test-seed",
  };
  dependencies = createDependencies();
};

describe("presentation mode", () => {
  beforeEach(setupPresentationEnvironment);

  it("ignores the flag in production", async () => {
    setEnvironment("NODE_ENV", "production");
    expect(isPresentationMode(environment)).toBeFalsy();
    expect(getPresentationCacheScope(environment)).toBe("live");
    await expect(
      Effect.runPromise(
        presentPositionCandidates(people, dependencies.presentation)
      )
    ).resolves.toBe(people);
    expect(dependencies.catalog.getOrganization).not.toHaveBeenCalled();
  });

  it.each(["development", "test", undefined])(
    "enables the flag outside production (NODE_ENV=%s)",
    (nodeEnvironment) => {
      setEnvironment("NODE_ENV", nodeEnvironment);
      expect(isPresentationMode(environment)).toBeTruthy();
      expect(getPresentationCacheScope(environment)).toMatch(/^present-v1-/u);
    }
  );

  it("does not enable without the flag", () => {
    setEnvironment("PRESENTATION_MODE", "0");
    expect(isPresentationMode(environment)).toBeFalsy();
  });

  it("keeps aliases deterministic, scoped by organization, person, and seed", () => {
    const alias = presentationIdentity("org-1", "person-1", "test-seed");
    expect(alias).toStrictEqual(
      presentationIdentity("org-1", "person-1", "test-seed")
    );
    expect(alias).not.toStrictEqual(
      presentationIdentity("org-2", "person-1", "test-seed")
    );
    expect(alias).not.toStrictEqual(
      presentationIdentity("org-1", "person-2", "test-seed")
    );
    expect(alias).not.toStrictEqual(
      presentationIdentity("org-1", "person-1", "other-seed")
    );
    const cacheScope = getPresentationCacheScope(environment);
    setEnvironment("PRESENTATION_SEED", "other-seed");
    expect(getPresentationCacheScope(environment)).not.toBe(cacheScope);
  });

  it("isolates organization caches for independent services sharing a scope", async () => {
    const otherDependencies = createDependencies();
    otherDependencies.catalog.getOrganization.mockReturnValue(
      Effect.succeed({
        id: "org-2",
        type: "Organization",
        attributes: { name: "Another Organization" },
      })
    );
    const [first, second] = await Effect.runPromise(
      Effect.all(
        [
          presentPositionCandidates(people, dependencies.presentation),
          presentPositionCandidates(people, otherDependencies.presentation),
        ],
        { concurrency: "unbounded" }
      )
    );
    expect([
      first.candidates[0].fullName,
      second.candidates[0].fullName,
    ]).toStrictEqual([
      presentationIdentity("org-1", "person-1", "test-seed").fullName,
      presentationIdentity("org-2", "person-1", "test-seed").fullName,
    ]);
  });

  it("masks every person view consistently without changing source data or scheduling fields", async () => {
    const original = structuredClone({
      people,
      groups,
      dashboard,
      detail,
      blockout,
    });
    const [presented, roster, overview, personDetail] = await Effect.runPromise(
      Effect.all(
        [
          presentPositionCandidates(people, dependencies.presentation),
          presentTeamPositions(groups, dependencies.presentation),
          presentDashboardRoster(dashboard, dependencies.presentation),
          presentDashboardPerson(detail, dependencies.presentation),
        ],
        { concurrency: "unbounded" }
      )
    );
    const [candidate] = presented.candidates;
    const alias = candidate.fullName;
    expect({
      names: [
        roster[0].positions[0].filledPeople?.[0]?.name,
        overview.people[0].name,
        personDetail.person.name,
      ],
      initials: personDetail.person.initials,
      candidate,
      roster: roster[0],
    }).toMatchObject({
      names: [alias, alias, alias],
      initials: candidate.firstName[0] + candidate.lastName[0],
      candidate: {
        id: "person-1",
        photoUrl: null,
        photoThumbnailUrl: null,
        selectedPlanRosterLabels: ["Band - Vocals"],
        selectedPlanSlot: {
          planPersonId: "plan-person-1",
          status: "declined",
          declineReason: "Unavailable",
        },
      },
      roster: { teamId: "band", teamName: "Band" },
    });
    const serialized = JSON.stringify([
      presented,
      presentPlanWindowHistory(windowHistory, true),
      presentCandidateDetails(candidateDetails, true),
      roster,
      overview,
      personDetail,
      presentBlockouts([blockout], true),
    ]);
    expect(serialized).not.toContain("Private");
    expect(serialized).not.toContain("https://private");
    expect({ people, groups, dashboard, detail, blockout }).toStrictEqual(
      original
    );
    expect(dependencies.catalog.getOrganization).toHaveBeenCalledOnce();
  });

  it("masks guest roster names and photos even without a person relationship", async () => {
    const guests = structuredClone(groups);
    const guest = guests[0].positions[0].filledPeople?.[0];
    if (!guest) {
      throw new Error("Expected a filled guest position");
    }
    guest.personId = null;
    const result = await Effect.runPromise(
      presentTeamPositions(guests, dependencies.presentation)
    );
    expect(result[0].positions[0].filledPeople?.[0]).toMatchObject({
      name: "Guest volunteer",
      photoThumbnailUrl: null,
    });
  });

  it("fails closed when organization identity cannot be resolved", async () => {
    dependencies.catalog.getOrganization.mockReturnValueOnce(
      Effect.fail(
        new PlanningCenterNetworkError({ cause: new Error("Unavailable") })
      )
    );
    await expect(
      Effect.runPromise(
        Effect.flip(
          presentPositionCandidates(people, dependencies.presentation)
        )
      )
    ).resolves.toMatchObject({ _tag: "PlanningCenterNetworkError" });
  });

  it("preserves normal-mode data, including notes and photos", async () => {
    setEnvironment("PRESENTATION_MODE", "0");
    await expect(
      Effect.runPromise(
        presentPositionCandidates(people, dependencies.presentation)
      )
    ).resolves.toBe(people);
    await expect(
      Effect.runPromise(presentTeamPositions(groups, dependencies.presentation))
    ).resolves.toBe(groups);
    await expect(
      Effect.runPromise(
        presentDashboardRoster(dashboard, dependencies.presentation)
      )
    ).resolves.toBe(dashboard);
    await expect(
      Effect.runPromise(
        presentDashboardPerson(detail, dependencies.presentation)
      )
    ).resolves.toBe(detail);
    const blockouts = [blockout];
    expect([
      presentBlockouts(blockouts, false),
      presentPlanWindowHistory(windowHistory, false),
      presentCandidateDetails(candidateDetails, false),
    ]).toStrictEqual([blockouts, windowHistory, candidateDetails]);
  });
});

describe("people search", () => {
  beforeEach(setupPresentationEnvironment);
  const resources = [
    {
      id: "person-1",
      type: "Person",
      attributes: {
        first_name: "Private",
        last_name: "Name",
        avatar: "https://private/photo",
      },
    },
  ];

  it("searches the displayed aliases, never real names or upstream name search", async () => {
    dependencies.people.getAllPeople.mockReturnValue(Effect.succeed(resources));
    const presentedPeople = await Effect.runPromise(
      presentPositionCandidates(people, dependencies.presentation)
    );
    const alias = presentedPeople.candidates[0].fullName;
    const results = await Effect.runPromise(
      searchPeople(alias.toLowerCase(), 15, dependencies.search)
    );
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      id: "person-1",
      fullName: alias,
      photoThumbnailUrl: null,
    });
    await expect(
      Effect.runPromise(searchPeople("Private Name", 15, dependencies.search))
    ).resolves.toStrictEqual([]);
    expect(dependencies.people.searchPeopleByName).not.toHaveBeenCalled();
    expect(JSON.stringify(results)).not.toContain("Private");
  });

  it("keeps the existing upstream search and real avatar in normal mode", async () => {
    setEnvironment("PRESENTATION_MODE", "0");
    dependencies.people.searchPeopleByName.mockReturnValue(
      Effect.succeed(resources)
    );
    await expect(
      Effect.runPromise(searchPeople("Private", 15, dependencies.search))
    ).resolves.toStrictEqual([
      {
        id: "person-1",
        firstName: "Private",
        lastName: "Name",
        fullName: "Private Name",
        photoThumbnailUrl: "https://private/photo",
      },
    ]);
    expect(dependencies.people.searchPeopleByName).toHaveBeenCalledWith(
      "Private",
      15
    );
    expect(dependencies.people.getAllPeople).not.toHaveBeenCalled();
  });
});

describe(getPresentationIdentityMapper, () => {
  beforeEach(setupPresentationEnvironment);

  it("reads the organization once through the organization cache", async () => {
    const mapper = getPresentationIdentityMapper(dependencies.presentation);

    const [first, second] = await Effect.runPromise(
      Effect.all([mapper, mapper], { concurrency: "unbounded" })
    );

    expect(first?.("person-1")).toStrictEqual(second?.("person-1"));
    expect(dependencies.catalog.getOrganization).toHaveBeenCalledOnce();
  });

  it("reuses the organization id across requests that share the isolate cache", async () => {
    const nextRequest = createDependencies();
    const shared = {
      ...nextRequest.presentation,
      organizationIds: dependencies.presentation.organizationIds,
    };

    const first = await Effect.runPromise(
      getPresentationIdentityMapper(dependencies.presentation)
    );
    const second = await Effect.runPromise(
      getPresentationIdentityMapper(shared)
    );

    expect(second?.("person-1")).toStrictEqual(first?.("person-1"));
    expect(dependencies.catalog.getOrganization).toHaveBeenCalledOnce();
    expect(nextRequest.catalog.getOrganization).not.toHaveBeenCalled();
  });
});
