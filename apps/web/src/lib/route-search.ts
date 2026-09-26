import { z } from "zod";

/**
 * Search params the product routes read. Values arrive as strings (`lib/search-params.ts`);
 * a repeated key arrives as an array. Only a single value is honored: repeated values are
 * ambiguous and read as absent rather than failing the page.
 */
const optionalParam = z
  .string()
  .optional()
  .or(
    z
      .array(z.string())
      .transform((values) => (values.length === 1 ? values[0] : undefined))
  );

/** `/auth`: where to go after sign-in, and a Better Auth OAuth error code. */
export const authSearchSchema = z.object({
  next: optionalParam,
  error: optionalParam,
});

/** Plan workspace views: the selected team position slot. */
export const planWorkspaceSearchSchema = z.object({
  teamId: optionalParam,
  positionId: optionalParam,
});

/** Person detail: the calendar month, `YYYY-MM`; the API validates it. */
export const personSearchSchema = z.object({
  month: optionalParam,
});

/** Song chord chart: the arrangement being edited; unknown ids fall back to the first. */
export const songChartSearchSchema = z.object({
  arrangement: optionalParam,
});
