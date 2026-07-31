export type LiveRatingInfo = {
  uscfId: string;
  asOfRating: number | null;
  deltaLiveRating: number | null;
  ratingDate: string | null;
  error?: string;
};

function nameTokens(s: string): string[] {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !["the", "and", "open", "chess", "tournament", "championship", "section"].includes(t));
}

function nameScore(a: string, b: string): number {
  const ta = nameTokens(a);
  const tb = new Set(nameTokens(b));
  if (!ta.length || !tb.size) return 0;
  let hit = 0;
  for (const t of ta) if (tb.has(t)) hit++;
  return hit / ta.length;
}

async function fetchOne(
  uscfId: string,
  asOfDate?: string,
  asOfEndDate?: string,
  eventName?: string,
): Promise<LiveRatingInfo> {
  try {
    // Walk the member's full event history (paginated) so recent events are
    // never missed for very active players.
    const all: any[] = [];
    let offset = 0;
    for (let page = 0; page < 6; page++) {
      const url = `https://ratings-api.uschess.org/api/v1/members/${uscfId}/sections?pageSize=100&offset=${offset}`;
      const res = await fetch(url, {
        headers: { Accept: "application/json", "User-Agent": "ChessToolsBot/1.0" },
      });
      if (!res.ok) {
        if (page === 0) {
          return { uscfId, asOfRating: null, deltaLiveRating: null, ratingDate: null, error: `HTTP ${res.status}` };
        }
        break;
      }
      const data: any = await res.json();
      const items: any[] = data?.items ?? [];
      for (const item of items) {
        const end = String(item?.event?.endDate ?? item?.endDate ?? "").slice(0, 10);
        const start = String(item?.startDate ?? item?.event?.startDate ?? end).slice(0, 10);
        const evName = String(item?.event?.name ?? "");
        for (const rec of item?.ratingRecords ?? []) {
          all.push({ ...rec, _date: end, _start: start, _event: evName });
        }
      }
      if (!data?.hasNextPage || !items.length) break;
      offset += items.length;
    }

    // Regular-rated records only, newest event first.
    const regular = all.filter((r) => r?.ratingSource === "R" && r._date);
    if (!regular.length) {
      return { uscfId, asOfRating: null, deltaLiveRating: 0, ratingDate: null };
    }
    regular.sort((a, b) => String(b._date).localeCompare(String(a._date)));

    if (asOfDate) {
      // 1) Best source: the tournament itself — its own preRating is exactly
      //    the rating the player carried into it. A festival window can hold
      //    several side events, so match on the event name when we have it,
      //    and otherwise take the earliest-starting rated event in the window
      //    (the main event).
      const windowEnd = asOfEndDate ?? asOfDate;
      const inWindow = regular
        .filter((r) => r._start >= asOfDate && r._start <= windowEnd && Number(r.preRating) > 0)
        .sort((a, b) => String(a._start).localeCompare(String(b._start)));

      let self = inWindow[0];
      if (eventName && inWindow.length > 1) {
        let best = self;
        let bestScore = 0;
        for (const r of inWindow) {
          const s = nameScore(eventName, r._event ?? "");
          if (s > bestScore) {
            bestScore = s;
            best = r;
          }
        }
        if (bestScore >= 0.5) self = best;
      }
      if (self) {
        return {
          uscfId,
          asOfRating: Number(self.preRating),
          deltaLiveRating: null,
          ratingDate: self._start,
        };
      }



      // 2) Otherwise use the post-rating of the most recently *completed*
      //    event before the tournament started (not a monthly supplement).
      const before = regular.find((r) => r._date < asOfDate && Number(r.postRating) > 0);
      if (before) {
        const post = Number(before.postRating);
        const pre = Number(before.preRating) || null;
        return {
          uscfId,
          asOfRating: post,
          deltaLiveRating: pre != null ? post - pre : null,
          ratingDate: before._date,
        };
      }

      // 3) Fallback: earliest known pre-rating (first rated event).
      const onAfter = [...regular].reverse().find((r) => Number(r.preRating) > 0);
      if (onAfter) {
        return {
          uscfId,
          asOfRating: Number(onAfter.preRating),
          deltaLiveRating: null,
          ratingDate: onAfter._start ?? onAfter._date,
        };
      }
      return { uscfId, asOfRating: null, deltaLiveRating: 0, ratingDate: null };
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
  asOfEndDate?: string;
  eventName?: string;
}): Promise<{ ratings: LiveRatingInfo[] }> {

    const unique = Array.from(new Set(data.uscfIds));
    // Light concurrency limit to be polite.
    const out: LiveRatingInfo[] = [];
    const concurrency = 6;
    let i = 0;
    async function worker() {
      while (i < unique.length) {
        const idx = i++;
        out[idx] = await fetchOne(unique[idx], data.asOfDate, data.asOfEndDate);
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, unique.length) }, worker));
    return { ratings: out };
}
