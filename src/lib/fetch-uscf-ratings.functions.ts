import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const InputSchema = z.object({
  uscfIds: z.array(z.string().regex(/^\d{6,10}$/)).min(1).max(60),
});

export type LiveRatingInfo = {
  uscfId: string;
  liveRating: number | null;
  deltaLiveRating: number | null;
  error?: string;
};

async function fetchOne(uscfId: string): Promise<LiveRatingInfo> {
  const url = `https://ratings-api.uschess.org/api/v1/members/${uscfId}/sections`;
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "ChessToolsBot/1.0" },
    });
    if (!res.ok) {
      return { uscfId, liveRating: null, deltaLiveRating: null, error: `HTTP ${res.status}` };
    }
    const data: any = await res.json();
    const all: any[] = [];
    for (const item of data?.items ?? []) {
      const date = item?.event?.endDate ?? "";
      for (const rec of item?.ratingRecords ?? []) {
        all.push({ ...rec, _date: date });
      }
    }
    const regular = all.filter((r) => r?.ratingSource === "R");
    if (!regular.length) {
      return { uscfId, liveRating: null, deltaLiveRating: 0 };
    }
    regular.sort((a, b) => String(b._date).localeCompare(String(a._date)));
    const mr = regular[0];
    const post = Number(mr.postRating) || null;
    const pre = Number(mr.preRating) || null;
    return {
      uscfId,
      liveRating: post,
      deltaLiveRating: post != null && pre != null ? post - pre : null,
    };
  } catch (e: any) {
    return { uscfId, liveRating: null, deltaLiveRating: null, error: e?.message ?? "fetch failed" };
  }
}

export const fetchUscfRatings = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => InputSchema.parse(d))
  .handler(async ({ data }): Promise<{ ratings: LiveRatingInfo[] }> => {
    const unique = Array.from(new Set(data.uscfIds));
    // Light concurrency limit to be polite.
    const out: LiveRatingInfo[] = [];
    const concurrency = 6;
    let i = 0;
    async function worker() {
      while (i < unique.length) {
        const idx = i++;
        out[idx] = await fetchOne(unique[idx]);
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, unique.length) }, worker));
    return { ratings: out };
  });
