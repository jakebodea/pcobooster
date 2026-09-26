import type { FlagshipEvaluationContext } from "@cloudflare/workers-types";
import {
  anonymousFeatureFlagSubject,
  createFlagshipFeatureFlags,
  createRegistryFeatureFlags,
} from "@pcobooster/api/modules/feature-flags/feature-flags";
import type {
  FeatureFlagFailure,
  FlagshipBinding,
} from "@pcobooster/api/modules/feature-flags/feature-flags";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

const signedIn = { userId: "user-1", planningCenterAccountId: "account-1" };

type Evaluate = FlagshipBinding["getBooleanDetails"];

const setup = (
  evaluate: Evaluate,
  resolveOrganizationId: (accountId: string) => Promise<string | null> = async (
    accountId
  ) => await Promise.resolve(`org-for-${accountId}`)
) => {
  const getBooleanDetails = vi.fn<Evaluate>(evaluate);
  const failures: FeatureFlagFailure[] = [];
  const flags = createFlagshipFeatureFlags({
    flagship: { getBooleanDetails },
    resolveOrganizationId,
    reportFailure: (failure) => {
      failures.push(failure);
    },
  });
  return { flags, getBooleanDetails, failures };
};

const serve =
  (value: boolean): Evaluate =>
  async (flagKey) =>
    await Promise.resolve({ flagKey, value, variant: value ? "on" : "off" });

describe(createFlagshipFeatureFlags, () => {
  it("evaluates the registry key with the user and organization as context", async () => {
    const { flags, getBooleanDetails, failures } = setup(serve(true));

    await expect(
      Effect.runPromise(flags.isEnabled("people", signedIn))
    ).resolves.toBeTruthy();
    expect(getBooleanDetails).toHaveBeenCalledWith("people-page", false, {
      targetingKey: "user-1",
      userId: "user-1",
      organizationId: "org-for-account-1",
    } satisfies FlagshipEvaluationContext);
    expect(failures).toStrictEqual([]);
  });

  it("sends no context for an anonymous caller", async () => {
    const resolveOrganizationId =
      vi.fn<(accountId: string) => Promise<string | null>>();
    const { flags, getBooleanDetails } = setup(
      serve(false),
      resolveOrganizationId
    );

    await expect(
      Effect.runPromise(flags.isEnabled("people", anonymousFeatureFlagSubject))
    ).resolves.toBeFalsy();
    expect(getBooleanDetails).toHaveBeenCalledWith("people-page", false, {});
    expect(resolveOrganizationId).not.toHaveBeenCalled();
  });

  it("omits an unrecorded organization", async () => {
    const { flags, getBooleanDetails } = setup(
      serve(true),
      async () => await Promise.resolve(null)
    );

    await Effect.runPromise(flags.isEnabled("people", signedIn));
    expect(getBooleanDetails).toHaveBeenCalledWith("people-page", false, {
      targetingKey: "user-1",
      userId: "user-1",
    });
  });

  it("serves off and reports an evaluation error, even if a value came back", async () => {
    const { flags, failures } = setup(
      async (flagKey) =>
        await Promise.resolve({
          flagKey,
          value: true,
          reason: "ERROR",
          errorCode: "FLAG_NOT_FOUND",
          errorMessage: "Flag not found",
        })
    );

    await expect(
      Effect.runPromise(flags.isEnabled("people", signedIn))
    ).resolves.toBeFalsy();
    expect(failures).toStrictEqual([
      {
        flag: "people",
        key: "people-page",
        errorCode: "FLAG_NOT_FOUND",
        message: "Flag not found",
        cause: null,
      },
    ]);
  });

  it("serves off and reports a binding that throws", async () => {
    const bindingError = new Error("binding unavailable");
    const { flags, failures } = setup(async () => {
      await Promise.resolve();
      throw bindingError;
    });

    await expect(
      Effect.runPromise(flags.isEnabled("people", signedIn))
    ).resolves.toBeFalsy();
    expect(failures).toStrictEqual([
      {
        flag: "people",
        key: "people-page",
        errorCode: "EVALUATION_THREW",
        message: "binding unavailable",
        cause: bindingError,
      },
    ]);
  });

  it("still evaluates for the user when the organization lookup fails", async () => {
    const lookupError = new Error("D1 unavailable");
    const { flags, getBooleanDetails, failures } = setup(
      serve(true),
      async () => {
        await Promise.resolve();
        throw lookupError;
      }
    );

    await expect(
      Effect.runPromise(flags.isEnabled("people", signedIn))
    ).resolves.toBeTruthy();
    expect(getBooleanDetails).toHaveBeenCalledWith("people-page", false, {
      targetingKey: "user-1",
      userId: "user-1",
    });
    expect(failures).toStrictEqual([
      {
        flag: "people",
        key: "people-page",
        errorCode: "ORGANIZATION_LOOKUP_FAILED",
        message: "D1 unavailable",
        cause: lookupError,
      },
    ]);
  });
});

describe(createRegistryFeatureFlags, () => {
  it.each([
    ["local", true],
    ["preview", true],
    ["production", false],
  ] as const)("serves the %s value of the People flag", async (tier, value) => {
    await expect(
      Effect.runPromise(
        createRegistryFeatureFlags(tier).isEnabled(
          "people",
          anonymousFeatureFlagSubject
        )
      )
    ).resolves.toBe(value);
  });
});
