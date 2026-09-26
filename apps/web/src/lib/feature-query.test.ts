import type { FeatureStatus } from "@pcobooster/contracts/features";
import { QueryClient } from "@tanstack/react-query";
import { isNotFound } from "@tanstack/react-router";
import { describe, expect, it, vi } from "vitest";

import { createFeatureQueryOptions, requireFeature } from "@/lib/feature-query";

const setup = (answer: FeatureStatus) => {
  const fetchPeopleFeature = vi
    .fn<() => Promise<FeatureStatus>>()
    .mockResolvedValue(answer);
  const options = createFeatureQueryOptions("people", fetchPeopleFeature);
  const queryClient = new QueryClient();
  const guard = async () => {
    try {
      await requireFeature(queryClient, options);
      return "allowed";
    } catch (error) {
      return isNotFound(error) ? "not-found" : error;
    }
  };
  return { fetchPeopleFeature, options, queryClient, guard };
};

describe(requireFeature, () => {
  it("asks the API and allows People when the flag is on", async () => {
    const { fetchPeopleFeature, options, queryClient, guard } = setup({
      enabled: true,
    });
    await expect(guard()).resolves.toBe("allowed");
    expect(fetchPeopleFeature).toHaveBeenCalledOnce();
    expect(queryClient.getQueryData(options.queryKey)).toStrictEqual({
      enabled: true,
    });
  });

  it("renders not found when the flag is off", async () => {
    const { guard } = setup({ enabled: false });
    await expect(guard()).resolves.toBe("not-found");
  });

  it("reuses a fresh answer, such as the one the app layout loaded", async () => {
    const { fetchPeopleFeature, options, queryClient, guard } = setup({
      enabled: true,
    });
    queryClient.setQueryData(options.queryKey, { enabled: false });
    await expect(guard()).resolves.toBe("not-found");
    expect(fetchPeopleFeature).not.toHaveBeenCalled();
  });
});
