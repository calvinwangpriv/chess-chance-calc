export type LiveRatingInfo = {
  uscfId: string;
  asOfRating: number | null;
  deltaLiveRating: number | null;
  ratingDate: string | null;
  error?: string;
};

async function fetchOne(uscfId: string, asOfDate?: string): Promise<LiveRatingInfo> {
  const url = `https://ratings-api.uschess.org/api/v1/members/${uscfId}/sections?pageSize=100`;
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "ChessToolsBot/1.0" },
    });
    if (!res.ok) {
      return { uscfId, asOfRating: null, deltaLiveRating: null, ratingDate: null, error: `HTTP ${res.status}` };
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
      return { uscfId, asOfRating: null, deltaLiveRating: 0, ratingDate: null };
    }
    // Newest first.
    regular.sort((a, b) => String(b._date).localeCompare(String(a._date)));

    if (asOfDate) {
      // The rating immediately before a tournament is the post-rating from
      // the latest event that ended strictly before this tournament started.
      // Do not use an on/after event: many history records omit preRating.
      const before = regular.find((r) => r._date < asOfDate);
      if (!before) return { uscfId, asOfRating: null, deltaLiveRating: 0, ratingDate: null };
      const post = Number(before.postRating) || null;
      const pre = Number(before.preRating) || null;
      return {
        uscfId,
        asOfRating: post,
        deltaLiveRating: post != null && pre != null ? post - pre : null,
        ratingDate: before._date,
      };
    }

    const mr = regular[0];
    const post = Number(mr.postRating) || null;
    const pre = Number(mr.preRating) || null;
    return {
      uscfId,
      asOfRating: post,
      deltaLiveRating: post != null && pre != null ? post - pre : null,
      ratingDate: mr._date,
    };
  } catch (e: any) {
    return { uscfId, asOfRating: null, deltaLiveRating: null, ratingDate: null, error: e?.message ?? "fetch failed" };
  }
}

export async function fetchUscfRatingsServer(data: {
  uscfIds: string[];
  asOfDate?: string;
}): Promise<{ ratings: LiveRatingInfo[] }> {
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
}
