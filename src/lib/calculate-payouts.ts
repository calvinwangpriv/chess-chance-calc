export type GameResult = "1-0" | "0-1" | "1/2" | null;
export type PlayerEntry = [string, number, number | null];
export type Pairing = [PlayerEntry, PlayerEntry, GameResult];

export interface ClassPrize {
  label: string;
  /** Inclusive rating range. null on a bound means open-ended. */
  minRating: number | null;
  maxRating: number | null;
  /** Ordered prize amounts (1st, 2nd, ...) within this class. */
  amounts: number[];
}

function resultToOutcomes(r: GameResult): [number, number][] {
  if (r === "1-0") return [[1.0, 0.0]];
  if (r === "0-1") return [[0.0, 1.0]];
  if (r === "1/2") return [[0.5, 0.5]];
  return [
    [1.0, 0.0],
    [0.5, 0.5],
    [0.0, 1.0],
  ];
}

export interface OutcomeBin {
  start: number;
  end: number;
  percent: number;
  count: number;
}

export interface OutcomeResult {
  outcome: "Win" | "Draw" | "Lose";
  bins: OutcomeBin[];
  exactPayout?: number;
  totalScenarios: number;
}

export interface CalcResult {
  totalBoards: number;
  criticalBoards: number;
  trivialBoards: number;
  targetStartScore: number;
  outcomes: OutcomeResult[];
  bestPayout: number;
  bestSummary: string;
}

function getCleanBins(absMin: number, absMax: number): [number, number][] {
  const span = absMax - absMin;
  if (span === 0) return [[absMax, absMax], [absMax, absMax], [absMax, absMax], [absMax, absMax]];
  let step: number;
  if (absMax > 1000) step = 200;
  else if (absMax > 500) step = 100;
  else if (absMax > 100) step = 50;
  else step = 25;

  const cleanMin = Math.floor(absMin / step) * step;
  let cleanMax = Math.ceil(absMax / step) * step;
  let width = (cleanMax - cleanMin) / 4;
  if (width % 5 !== 0 && width > 5) {
    width = Math.ceil(width / 25) * 25;
    cleanMax = cleanMin + width * 4;
  }
  const bins: [number, number][] = [];
  for (let i = 0; i < 4; i++) {
    bins.push([Math.round(cleanMin + i * width), Math.round(cleanMin + (i + 1) * width)]);
  }
  return bins;
}

interface PrizeSlot {
  label: string;
  amount: number;
  /** null predicate = open to anyone (overall prize). */
  eligible: ((rating: number | null) => boolean) | null;
}

/**
 * Allocate prizes (overall + class) USCF-style:
 * - Each player wins at most one cash prize, the largest they qualify for.
 * - For each prize (largest first), award to the highest-scoring unpaid
 *   eligible player; ties at that score split this prize equally.
 * Returns the cash the target player ends up with.
 */
function allocateTargetPayout(
  finalScores: Record<string, number>,
  ratings: Record<string, number | null>,
  prizes: PrizeSlot[],
  targetPlayer: string,
): number {
  const paid = new Set<string>();
  let targetCash = 0;
  // Sort all prizes globally by amount desc.
  const sorted = [...prizes].sort((a, b) => b.amount - a.amount);
  // Players sorted by score desc (stable).
  const players = Object.keys(finalScores).sort(
    (a, b) => finalScores[b] - finalScores[a],
  );
  for (const prize of sorted) {
    const eligibleUnpaid = players.filter((p) => {
      if (paid.has(p)) return false;
      if (!prize.eligible) return true;
      return prize.eligible(ratings[p] ?? null);
    });
    if (eligibleUnpaid.length === 0) continue;
    const topScore = finalScores[eligibleUnpaid[0]];
    const tied = eligibleUnpaid.filter((p) => finalScores[p] === topScore);
    const share = prize.amount / tied.length;
    for (const p of tied) {
      paid.add(p);
      if (p === targetPlayer) targetCash += share;
    }
  }
  return targetCash;
}

export function calculatePayouts(
  pairings: Pairing[],
  targetPlayer: string,
  prizes: number[],
  classPrizes: ClassPrize[] = [],
): CalcResult {
  let targetStartScore: number | null = null;
  for (const [w, b] of pairings) {
    if (w[0] === targetPlayer) targetStartScore = w[1];
    if (b[0] === targetPlayer) targetStartScore = b[1];
  }
  if (targetStartScore === null) {
    throw new Error(`Player "${targetPlayer}" not found in pairings.`);
  }

  // Collect ratings.
  const ratings: Record<string, number | null> = {};
  for (const [w, b] of pairings) {
    ratings[w[0]] = w[2];
    ratings[b[0]] = b[2];
  }

  // Build full prize slot list.
  const prizeSlots: PrizeSlot[] = [];
  prizes.forEach((amt, i) =>
    prizeSlots.push({ label: `${ordinal(i + 1)} overall`, amount: amt, eligible: null }),
  );
  for (const cp of classPrizes) {
    cp.amounts.forEach((amt, i) =>
      prizeSlots.push({
        label: `${ordinal(i + 1)} ${cp.label}`,
        amount: amt,
        eligible: (r) => {
          if (r === null) return false; // unrated not eligible for class prizes
          if (cp.minRating !== null && r < cp.minRating) return false;
          if (cp.maxRating !== null && r > cp.maxRating) return false;
          return true;
        },
      }),
    );
  }

  const baseline: Record<string, number> = {};
  const variable: Pairing[] = [];
  let trivialCount = 0;

  for (const game of pairings) {
    const [w, b, res] = game;
    const isTarget = w[0] === targetPlayer || b[0] === targetPlayer;

    if (res !== null) {
      const [wOut, bOut] = resultToOutcomes(res)[0];
      if (!isTarget) {
        baseline[w[0]] = w[1] + wOut;
        baseline[b[0]] = b[1] + bOut;
        continue;
      }
      variable.push(game);
      continue;
    }

    if (isTarget) {
      variable.push(game);
      continue;
    }

    // With class prizes in play, "can't affect target's prize" is harder to
    // prove safely. Only skip if class prizes empty AND clearly out of range.
    const wMax = w[1] + 1.0;
    const bMax = b[1] + 1.0;
    if (
      classPrizes.length === 0 &&
      wMax < targetStartScore &&
      bMax < targetStartScore
    ) {
      baseline[w[0]] = w[1] + 0.5;
      baseline[b[0]] = b[1] + 0.5;
      trivialCount++;
    } else {
      variable.push(game);
    }
  }

  const dist = {
    Win: new Map<number, number>(),
    Draw: new Map<number, number>(),
    Lose: new Map<number, number>(),
  };

  const optionsPerGame = variable.map((g) => resultToOutcomes(g[2]));
  const radix = optionsPerGame.map((o) => o.length);
  const total = radix.reduce((a, b) => a * b, 1);
  if (total > 2_000_000) {
    throw new Error(
      `Too many scenarios (${total.toLocaleString()}). Too many boards near your score to simulate.`,
    );
  }

  const n = variable.length;
  const scenario = new Array<number>(n).fill(0);
  let bestPayout = -Infinity;
  const bestMasks: number[] = new Array(n).fill(0);
  for (let s = 0; s < total; s++) {
    let rem = s;
    for (let i = 0; i < n; i++) {
      scenario[i] = rem % radix[i];
      rem = Math.floor(rem / radix[i]);
    }
    const finalScores: Record<string, number> = { ...baseline };
    let targetOutcome: "Win" | "Draw" | "Lose" = "Lose";
    for (let i = 0; i < n; i++) {
      const game = variable[i];
      const out = optionsPerGame[i][scenario[i]];
      finalScores[game[0][0]] = game[0][1] + out[0];
      finalScores[game[1][0]] = game[1][1] + out[1];
      if (game[0][0] === targetPlayer) {
        targetOutcome = out[0] === 1 ? "Win" : out[0] === 0.5 ? "Draw" : "Lose";
      } else if (game[1][0] === targetPlayer) {
        targetOutcome = out[1] === 1 ? "Win" : out[1] === 0.5 ? "Draw" : "Lose";
      }
    }

    const targetPayout = allocateTargetPayout(finalScores, ratings, prizeSlots, targetPlayer);

    const m = dist[targetOutcome];
    m.set(targetPayout, (m.get(targetPayout) ?? 0) + 1);
    if (targetPayout > bestPayout) {
      bestPayout = targetPayout;
      for (let i = 0; i < n; i++) bestMasks[i] = 1 << scenario[i];
    } else if (targetPayout === bestPayout) {
      for (let i = 0; i < n; i++) bestMasks[i] |= 1 << scenario[i];
    }
  }

  const result: OutcomeResult[] = (["Win", "Draw", "Lose"] as const).map((outcome) => {
    const m = dist[outcome];
    const totalScenarios = Array.from(m.values()).reduce((a, b) => a + b, 0);
    if (totalScenarios === 0) {
      return { outcome, bins: [], totalScenarios: 0 };
    }
    const payouts = Array.from(m.keys());
    const absMax = Math.max(...payouts);
    const absMin = Math.min(...payouts);
    if (absMax === absMin) {
      return { outcome, bins: [], totalScenarios, exactPayout: absMax };
    }
    const cleanBins = getCleanBins(absMin, absMax);
    const quad = [0, 0, 0, 0];
    for (const [cash, count] of m.entries()) {
      let placed = false;
      for (let i = 0; i < 4; i++) {
        const [bStart, bEnd] = cleanBins[i];
        if (i === 3) {
          if (cash >= bStart && cash <= bEnd + 1) {
            quad[i] += count;
            placed = true;
            break;
          }
        } else {
          if (cash >= bStart && cash < bEnd) {
            quad[i] += count;
            placed = true;
            break;
          }
        }
      }
      if (!placed) {
        if (cash >= cleanBins[3][0]) quad[3] += count;
        else quad[0] += count;
      }
    }
    const bins: OutcomeBin[] = cleanBins.map(([start, end], i) => ({
      start,
      end,
      percent: (quad[i] / totalScenarios) * 100,
      count: quad[i],
    }));
    return { outcome, bins, totalScenarios };
  });

  const phrases: string[] = [];
  let targetWish: string | null = null;
  for (let i = 0; i < n; i++) {
    if (radix[i] === 1) continue;
    const game = variable[i];
    const [wName] = game[0];
    const [bName] = game[1];
    const mask = bestMasks[i];
    if (mask === 0b111) continue;
    const isTarget = wName === targetPlayer || bName === targetPlayer;
    if (isTarget) {
      const targetIsWhite = wName === targetPlayer;
      const winBit = targetIsWhite ? 0b001 : 0b100;
      const loseBit = targetIsWhite ? 0b100 : 0b001;
      const wants: string[] = [];
      if (mask & winBit) wants.push("win");
      if (mask & 0b010) wants.push("draw");
      if (mask & loseBit) wants.push("lose");
      targetWish = wants.join(" or ");
    } else {
      switch (mask) {
        case 0b001: phrases.push(`${wName} beats ${bName}`); break;
        case 0b100: phrases.push(`${bName} beats ${wName}`); break;
        case 0b010: phrases.push(`${wName} and ${bName} draw`); break;
        case 0b011: phrases.push(`${wName} doesn't lose to ${bName}`); break;
        case 0b110: phrases.push(`${bName} doesn't lose to ${wName}`); break;
        case 0b101: phrases.push(`${wName} vs ${bName} isn't a draw`); break;
      }
    }
  }

  const outcomeStats = (["Win", "Draw", "Lose"] as const).map((o) => {
    const m = dist[o];
    const tot = Array.from(m.values()).reduce((a, b) => a + b, 0);
    const max = tot ? Math.max(...m.keys()) : 0;
    const min = tot ? Math.min(...m.keys()) : 0;
    let avg = 0;
    for (const [cash, c] of m.entries()) avg += cash * c;
    avg = tot ? avg / tot : 0;
    return { outcome: o, total: tot, max, min, avg };
  });
  const winStat = outcomeStats[0];
  const loseStat = outcomeStats[2];
  const drawStat = outcomeStats[1];

  const sentences: string[] = [];
  if (targetWish) {
    sentences.push(`Your best-case payout is $${bestPayout.toLocaleString()}, and it requires you to ${targetWish} your own game.`);
  } else {
    sentences.push(`Your best-case payout is $${bestPayout.toLocaleString()} regardless of how your own game ends.`);
  }
  if (phrases.length === 0) {
    sentences.push(`No specific results from the other critical boards are required to hit it.`);
  } else if (phrases.length <= 3) {
    sentences.push(`To lock it in you also need: ${phrases.join("; ")}.`);
  } else {
    sentences.push(`To lock it in you also need ${phrases.length} other board results to break a specific way (e.g. ${phrases.slice(0, 2).join("; ")}; and ${phrases.length - 2} more).`);
  }
  const fmt = (n: number) => `$${Math.round(n).toLocaleString()}`;
  const parts: string[] = [];
  if (winStat.total) parts.push(`win → avg ${fmt(winStat.avg)} (worst ${fmt(winStat.min)}, best ${fmt(winStat.max)})`);
  if (drawStat.total) parts.push(`draw → avg ${fmt(drawStat.avg)} (worst ${fmt(drawStat.min)}, best ${fmt(drawStat.max)})`);
  if (loseStat.total) parts.push(`lose → avg ${fmt(loseStat.avg)} (worst ${fmt(loseStat.min)}, best ${fmt(loseStat.max)})`);
  if (parts.length) sentences.push(`Across all ${total.toLocaleString()} remaining scenarios: ${parts.join("; ")}.`);
  if (variable.length > 1) {
    sentences.push(`${variable.length} boards near your score actually move your prize — the other ${trivialCount} are too far away to matter.`);
  }
  const bestSummary = sentences.join(" ");

  return {
    totalBoards: pairings.length,
    criticalBoards: variable.length,
    trivialBoards: trivialCount,
    targetStartScore,
    outcomes: result,
    bestPayout: bestPayout === -Infinity ? 0 : bestPayout,
    bestSummary,
  };
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

const CLASS_RANGES: Record<string, [number | null, number | null]> = {
  "senior master": [2400, null],
  "master": [2200, 2399],
  "expert": [2000, 2199],
  "class a": [1800, 1999],
  "class b": [1600, 1799],
  "class c": [1400, 1599],
  "class d": [1200, 1399],
  "class e": [1000, 1199],
  "class f": [800, 999],
  "class g": [600, 799],
  "class h": [400, 599],
  "class i": [200, 399],
  "class j": [null, 199],
};

/**
 * Parse a class-prize block. One class per line:
 *   "Under 2000: 600, 400, 200"
 *   "Class A: 500, 300"
 *   "1600-1799: 400, 200"
 */
export function parseClassPrizes(text: string): ClassPrize[] {
  const out: ClassPrize[] = [];
  for (const raw of text.split(/\n+/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^(.+?):\s*(.+)$/);
    if (!m) continue;
    const label = m[1].trim();
    const amounts = m[2]
      .split(/[,\s]+/)
      .map((s) => Number(s.replace(/[^\d.]/g, "")))
      .filter((n) => Number.isFinite(n) && n > 0);
    if (!amounts.length) continue;

    let minRating: number | null = null;
    let maxRating: number | null = null;
    const lower = label.toLowerCase();

    const under = lower.match(/under\s*(\d+)/) || lower.match(/^u\s*(\d+)/);
    const range = lower.match(/(\d{3,4})\s*[-–]\s*(\d{3,4})/);
    if (range) {
      minRating = Number(range[1]);
      maxRating = Number(range[2]);
    } else if (under) {
      maxRating = Number(under[1]) - 1;
    } else {
      for (const [key, [mn, mx]] of Object.entries(CLASS_RANGES)) {
        if (lower.includes(key)) {
          minRating = mn;
          maxRating = mx;
          break;
        }
      }
    }

    out.push({ label, minRating, maxRating, amounts });
  }
  return out;
}
