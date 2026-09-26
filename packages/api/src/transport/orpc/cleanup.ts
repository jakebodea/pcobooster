import {
  getCleanupPeopleActivity,
  getCleanupPeopleRoster,
  getCleanupSongs,
} from "@pcobooster/api/application/cleanup";
import { rpc } from "@pcobooster/api/transport/orpc/implementation";
import { readWithPlanningCenter } from "@pcobooster/api/transport/orpc/planning-center-procedure";

const songs = rpc.cleanup.songs.handler(
  async ({ input, ...call }) =>
    await readWithPlanningCenter(getCleanupSongs(input), call)
);

const peopleRoster = rpc.cleanup.peopleRoster.handler(
  async (call) => await readWithPlanningCenter(getCleanupPeopleRoster(), call)
);

const peopleActivity = rpc.cleanup.peopleActivity.handler(
  async ({ input, ...call }) =>
    await readWithPlanningCenter(getCleanupPeopleActivity(input), call)
);

export const cleanupRouter = {
  songs,
  peopleRoster,
  peopleActivity,
};
