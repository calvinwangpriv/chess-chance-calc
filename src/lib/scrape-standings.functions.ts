import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { scrapeStandingsServer } from "./scrape-standings.server";

export const scrapeStandings = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => z.object({ url: z.string().url() }).parse(data))
  .handler(async ({ data }) => scrapeStandingsServer(data));