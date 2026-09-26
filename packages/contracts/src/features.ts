import { oc } from "@orpc/contract";
import { applicationErrorMap } from "@pcobooster/contracts/errors";
import { z } from "zod";

export const featureInputSchema = z.object({});
export const featureSchema = z.object({ enabled: z.boolean() });

const featureProcedure = oc.errors({
  INTERNAL_SERVER_ERROR: applicationErrorMap.INTERNAL_SERVER_ERROR,
});

export const featuresContract = {
  people: featureProcedure
    .route({
      method: "GET",
      path: "/features/people",
      summary: "Check whether the People dashboard is enabled",
    })
    .input(featureInputSchema)
    .output(featureSchema),
  chordCharts: featureProcedure
    .route({
      method: "GET",
      path: "/features/chord-charts",
      summary: "Check whether the chord chart editor is enabled",
    })
    .input(featureInputSchema)
    .output(featureSchema),
  cleanup: featureProcedure
    .route({
      method: "GET",
      path: "/features/cleanup",
      summary: "Check whether the Data cleanup page is enabled",
    })
    .input(featureInputSchema)
    .output(featureSchema),
};

export type FeatureStatus = z.output<typeof featureSchema>;
