import { pcResourceSchema } from "@pcobooster/api/planning-center/resource-schemas";
import type { PlanningCenterPeopleServiceCaches } from "@pcobooster/api/planning-center/services/people-service";
import type { PlanningCenterReadCache } from "@pcobooster/api/planning-center/services/read-cache";
import type { SharedReadCodec } from "@pcobooster/api/planning-center/services/shared-read-store";
import type { PCResource } from "@pcobooster/planning-center-models/types";
import { z } from "zod";

type CachedValue<Cache> =
  Cache extends PlanningCenterReadCache<infer Value> ? Value : never;

type AllTeamPeople = CachedValue<
  PlanningCenterPeopleServiceCaches["allTeamPeople"]
>;

const resourcesSchema = z.array(pcResourceSchema);

const storedAllTeamPeopleSchema = z.object({
  people: resourcesSchema,
  included: resourcesSchema,
  teams: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      serviceTypeName: z.string().nullable(),
      personIds: z.array(z.string()),
      leaderPersonIds: z.array(z.string()),
    })
  ),
});

/** Parses stored text with a schema; anything malformed or unexpected is `null`. */
const parseStored = <Schema extends z.ZodType>(
  schema: Schema,
  stored: string
): z.infer<Schema> | null => {
  try {
    const parsed = schema.safeParse(JSON.parse(stored));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

/** Resources are validated like a fresh Planning Center response. */
export const resourceListCodec: SharedReadCodec<PCResource[]> = {
  encode: (resources) => JSON.stringify(resources),
  decode: (stored) => parseStored(resourcesSchema, stored),
};

export const allTeamPeopleCodec: SharedReadCodec<AllTeamPeople> = {
  encode: (value) => JSON.stringify(value),
  decode: (stored) => parseStored(storedAllTeamPeopleSchema, stored),
};
