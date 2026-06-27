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

/**
 * Pool prizes among tied players within a single ranked prize list.
 * Walk players in descending score order; each score group collectively
 * claims the next group.length prizes from the top of the remaining list
 * and splits the sum equally. (USCF tie-pooling.)
 */
function poolShares(
  eligible: string[],
  prizeAmounts: number[],
  finalScores: Record<string, number>,
): Map<string, number> {
  const shares = new Map<string, number>();
  if (prizeAmounts.length === 0 || eligible.length === 0) return shares;
  const sorted = [...eligible].sort(
    (a, b) => finalScores[b] - finalScores[a],
  );
  let i = 0;
  let pIdx = 0;
  while (i < sorted.length && pIdx < prizeAmounts.length) {
    const score = finalScores[sorted[i]];
    let j = i;
    while (j < sorted.length && finalScores[sorted[j]] === score) j++;
    const groupSize = j - i;
    const take = prizeAmounts.slice(
      pIdx,
      Math.min(pIdx + groupSize, prizeAmounts.length),
    );
    const share = take.reduce((a, b) => a + b, 0) / groupSize;
    for (let k = i; k < j; k++) shares.set(sorted[k], share);
    pIdx += take.length;
    i = j;
  }
  return shares;
}

function classEligible(rating: number | null, cp: ClassPrize): boolean {
  if (rating === null) return false;
  if (cp.minRating !== null && rating < cp.minRating) return false;
  if (cp.maxRating !== null && rating > cp.maxRating) return false;
  return true;
}

/**
 * Allocate prizes USCF-style with tie pooling and overall-vs-class cascading:
 * - Within each prize pool (overall, and each class), tied players pool the
 *   prizes they collectively occupy and split equally.
 * - Each player takes the LARGER of their overall share vs their class share.
 *   If they take one, they're removed from competition in the other so the
 *   freed slot cascades to the next eligible player. Iterates to stability.
 */
function allocateTargetPayout(
  finalScores: Record<string, number>,
  ratings: Record<string, number | null>,
  overallPrizes: number[],
  classPrizes: ClassPrize[],
  targetPlayer: string,
): { payout: number; source: string } {
  const players = Object.keys(finalScores);
  // pick[p] = "overall" | classIndex (as string) | "none"
  let pick: Record<string, string> = {};
  for (const p of players) pick[p] = "overall"; // initial guess

  for (let iter = 0; iter < 25; iter++) {
    // Overall competitors = players who currently pick overall (or haven't given up on it).
    // We let any player compete for overall unless they currently picked class.
    const overallElig = players.filter((p) => pick[p] === "overall");
    const overallShares = poolShares(overallElig, overallPrizes, finalScores);

    const classSharesAll: Map<string, number>[] = classPrizes.map((cp, ci) => {
      const elig = players.filter(
        (p) =>
          classEligible(ratings[p] ?? null, cp) &&
          (pick[p] === String(ci) || pick[p] === "overall"),
        // a player competing for overall is also still a candidate for class
        // until they commit; this lets the iteration discover the best choice
      );
      return poolShares(elig, cp.amounts, finalScores);
    });

    const newPick: Record<string, string> = {};
    for (const p of players) {
      let bestAmt = overallShares.get(p) ?? 0;
      let bestKey = "overall";
      classPrizes.forEach((cp, ci) => {
        if (!classEligible(ratings[p] ?? null, cp)) return;
        const s = classSharesAll[ci].get(p) ?? 0;
        if (s > bestAmt) {
          bestAmt = s;
          bestKey = String(ci);
        }
      });
      if (bestAmt === 0) bestKey = "none";
      newPick[p] = bestKey;
    }

    let stable = true;
    for (const p of players) {
      if (newPick[p] !== pick[p]) {
        stable = false;
        break;
      }
    }
    pick = newPick;
    if (stable) break;
  }

  // Final pass: recompute shares with committed picks and read target's payout.
  const overallElig = players.filter((p) => pick[p] === "overall");
  const overallShares = poolShares(overallElig, overallPrizes, finalScores);
  const finalClassShares = classPrizes.map((cp, ci) => {
    const elig = players.filter(
      (p) => pick[p] === String(ci) && classEligible(ratings[p] ?? null, cp),
    );
    return poolShares(elig, cp.amounts, finalScores);
  });

  const choice = pick[targetPlayer];
  if (choice === "overall") {
    return { payout: overallShares.get(targetPlayer) ?? 0, source: "overall" };
  }
  if (choice === "none") return { payout: 0, source: "none" };
  const ci = Number(choice);
  const cp = classPrizes[ci];
  return {
    payout: finalClassShares[ci]?.get(targetPlayer) ?? 0,
    source: cp?.label ?? "class",
  };
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

  // (prize slot list no longer needed — allocator takes overall + class lists directly)


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

    // Trivial board: both opponents' MAX possible final score is strictly
    // below the target's MIN possible final score. They can't outrank or tie
    // the target in any prize pool, so the outcome doesn't affect payout.
    const wMax = w[1] + 1.0;
    const bMax = b[1] + 1.0;
    if (wMax < targetStartScore && bMax < targetStartScore) {
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
  const bestSourceDist = new Map<string, number>();
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

    const { payout: targetPayout, source: targetSource } = allocateTargetPayout(finalScores, ratings, prizes, classPrizes, targetPlayer);

    const m = dist[targetOutcome];
    m.set(targetPayout, (m.get(targetPayout) ?? 0) + 1);
    if (targetPayout > bestPayout) {
      bestPayout = targetPayout;
      bestSourceDist.clear();
      bestSourceDist.set(targetSource, 1);
      for (let i = 0; i < n; i++) bestMasks[i] = 1 << scenario[i];
    } else if (targetPayout === bestPayout) {
      bestSourceDist.set(targetSource, (bestSourceDist.get(targetSource) ?? 0) + 1);
      for (let i = 0; i < n; i++) bestMasks[i] |= 1 << scenario[i];
    }
  }

  let bestSource = "none";
  let bestSourceCount = 0;
  for (const [src, count] of bestSourceDist.entries()) {
    if (count > bestSourceCount) {
      bestSourceCount = count;
      bestSource = src;
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

  if (bestClassPrize) {
    sentences.push(`That top payout comes from the ${bestClassPrize.label} prize.`);
  }

  if (phrases.length === 0) {
    sentences.push(`No specific results from the other critical boards are required to hit it.`);
  } else if (phrases.length <= 3) {
    sentences.push(`To lock it in you also need: ${phrases.join("; ")}.`);
  } else {
    sentences.push(`To lock it in you also need ${phrases.length} other board results to break a specific way (e.g. ${phrases.slice(0, 2).join("; ")}; and ${phrases.length - 2} more).`);
  }

  // Class-prize specific rooting guidance.
  const targetClassPrizes = classPrizes.filter((cp) => classEligible(ratings[targetPlayer], cp));
  if (targetClassPrizes.length > 0) {
    const classesToRoot = bestClassPrize ? [bestClassPrize] : targetClassPrizes;
    for (const cp of classesToRoot) {
      const classPhrases: string[] = [];
      for (let i = 0; i < n; i++) {
        if (radix[i] === 1) continue;
        const game = variable[i];
        const [w, b] = game;
        const mask = bestMasks[i];
        if (mask === 0b111) continue;
        if (w[0] === targetPlayer || b[0] === targetPlayer) continue;

        const wElig = classEligible(w[2], cp);
        const bElig = classEligible(b[2], cp);
        if (!wElig && !bElig) continue;

        if (wElig && mask === 0b100) {
          classPhrases.push(`${w[0]} loses to ${b[0]}`);
        } else if (wElig && !(mask & 0b001)) {
          classPhrases.push(`${w[0]} doesn't beat ${b[0]}`);
        }

        if (bElig && mask === 0b001) {
          classPhrases.push(`${b[0]} loses to ${w[0]}`);
        } else if (bElig && !(mask & 0b100)) {
          classPhrases.push(`${b[0]} doesn't beat ${w[0]}`);
        }
      }
      if (classPhrases.length) {
        sentences.push(`For the ${cp.label} prize, you want ${classPhrases.join("; ")} to eliminate competition.`);
      }
    }
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
