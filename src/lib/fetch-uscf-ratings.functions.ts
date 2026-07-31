import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { fetchUscfRatingsServer, type LiveRatingInfo } from "./fetch-uscf-ratings.server";

export type { LiveRatingInfo };

export const fetchUscfRatings = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) =>
    z.object({
      uscfIds: z.array(z.string().regex(/^\d{6,10}$/)).min(1).max(300),
      asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      asOfEndDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }).parse(data),
  )
  .handler(async ({ data }): Promise<{ ratings: LiveRatingInfo[] }> => fetchUscfRatingsServer(data));