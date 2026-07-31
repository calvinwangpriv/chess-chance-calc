import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const InputSchema = z.object({
  uscfIds: z.array(z.string().regex(/^\d{6,10}$/)).min(1).max(60),
  /** Optional "YYYY-MM-DD" — use each player's rating as of just before this date. */
  asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export type LiveRatingInfo = {
  uscfId: string;
  liveRating: number | null;
  deltaLiveRating: number | null;
  error?: string;
};

async function fetchOne(uscfId: string, asOfDate?: string): Promise<LiveRatingInfo> {
  const url = `https://ratings-api.uschess.org/api/v1/members/${uscfId}/sections?pageSize=100`;
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
      const date = String(item?.event?.endDate ?? item?.endDate ?? "").slice(0, 10);
      for (const rec of item?.ratingRecords ?? []) {
        all.push({ ...rec, _date: date });
      }
    }
    const regular = all.filter((r) => r?.ratingSource === "R" && r._date);
    if (!regular.length) {
      return { uscfId, liveRating: null, deltaLiveRating: 0 };
    }
    // Newest first.
    regular.sort((a, b) => String(b._date).localeCompare(String(a._date)));

    if (asOfDate) {
      // If the tournament itself (or anything on/after its date) is already
      // rated, the correct pre-event rating is that event's preRating.
      const onOrAfter = regular.filter((r) => r._date >= asOfDate);
      if (onOrAfter.length) {
        const earliest = onOrAfter[onOrAfter.length - 1];
        const pre = Number(earliest.preRating) || null;
        if (pre != null) return { uscfId, liveRating: pre, deltaLiveRating: null };
      }
      // Otherwise use the postRating of the last event finished before it.
      const before = regular.find((r) => r._date < asOfDate);
      if (!before) return { uscfId, liveRating: null, deltaLiveRating: 0 };
      const post = Number(before.postRating) || null;
      const pre = Number(before.preRating) || null;
      return {
        uscfId,
        liveRating: post,
        deltaLiveRating: post != null && pre != null ? post - pre : null,
      };
    }

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
        out[idx] = await fetchOne(unique[idx], data.asOfDate);
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, unique.length) }, worker));
    return { ratings: out };
  });
