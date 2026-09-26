import {
  deploymentTier,
  featureFlagNames,
  featureFlags,
} from "@pcobooster/api/config/feature-flags";
import { describe, expect, it } from "vitest";

/** Flagship: letters, numbers, hyphens, and underscores, at most 64 characters. */
const flagshipKeyPattern = /^[\w-]{1,64}$/u;
const MAX_DESCRIPTION_LENGTH = 512;

describe("feature flag registry", () => {
  it("lists every flag", () => {
    expect(featureFlagNames).toStrictEqual(Object.keys(featureFlags));
  });

  it("uses unique keys Flagship accepts", () => {
    const keys = featureFlagNames.map((name) => featureFlags[name].key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const name of featureFlagNames) {
      const { key, description } = featureFlags[name];
      expect(key).toMatch(flagshipKeyPattern);
      expect(description.length).toBeLessThanOrEqual(MAX_DESCRIPTION_LENGTH);
    }
  });

  it("keeps People on locally and in previews, off in production", () => {
    expect(featureFlags.people.enabled).toStrictEqual({
      local: true,
      preview: true,
      production: false,
    });
  });

  it("keeps chord charts on locally and in previews, off in production", () => {
    expect(featureFlags.chordCharts.enabled).toStrictEqual({
      local: true,
      preview: true,
      production: false,
    });
  });

  it("keeps Data cleanup on locally and in previews, off in production", () => {
    expect(featureFlags.cleanup.enabled).toStrictEqual({
      local: true,
      preview: true,
      production: false,
    });
  });
});

describe(deploymentTier, () => {
  it("maps each stage to its tier", () => {
    expect(deploymentTier({ production: true, local: false })).toBe(
      "production"
    );
    expect(deploymentTier({ production: false, local: true })).toBe("local");
    expect(deploymentTier({ production: false, local: false })).toBe("preview");
  });
});
