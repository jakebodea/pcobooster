import { oc } from "@orpc/contract";
import { accountsContract } from "@pcobooster/contracts/accounts";
import { adminContract } from "@pcobooster/contracts/admin";
import { catalogContract } from "@pcobooster/contracts/catalog";
import { chordChartsContract } from "@pcobooster/contracts/chord-charts";
import { demoContract } from "@pcobooster/contracts/demo";
import { featuresContract } from "@pcobooster/contracts/features";
import { feedbackContract } from "@pcobooster/contracts/feedback";
import { peopleContract } from "@pcobooster/contracts/people";
import { planItemsContract } from "@pcobooster/contracts/plan-items";
import { planPeopleContract } from "@pcobooster/contracts/plan-people";
import { planTimesContract } from "@pcobooster/contracts/plan-times";
import { scheduleContract } from "@pcobooster/contracts/schedule";
import { sessionContract } from "@pcobooster/contracts/session";
import { songsContract } from "@pcobooster/contracts/songs";
import { z } from "zod";

const healthInputSchema = z.object({});
const healthOutputSchema = z.object({
  status: z.literal("ok"),
  version: z.string(),
});

export const healthContract = oc
  .route({
    method: "GET",
    path: "/health",
    summary: "Report API health",
  })
  .input(healthInputSchema)
  .output(healthOutputSchema);

export const appContract = oc.router({
  accounts: accountsContract,
  admin: adminContract,
  catalog: catalogContract,
  chordCharts: chordChartsContract,
  demo: demoContract,
  features: featuresContract,
  feedback: feedbackContract,
  health: healthContract,
  people: peopleContract,
  planItems: planItemsContract,
  planPeople: planPeopleContract,
  planTimes: planTimesContract,
  schedule: scheduleContract,
  session: sessionContract,
  songs: songsContract,
});

export type AppContract = typeof appContract;
export type HealthInput = z.input<typeof healthInputSchema>;
export type HealthOutput = z.output<typeof healthOutputSchema>;
