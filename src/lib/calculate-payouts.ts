export type GameResult = "1-0" | "0-1" | "1/2" | null;
export type Pairing = [[string, number], [string, number], GameResult];

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

export function calculatePayouts(
  pairings: Pairing[],
  targetPlayer: string,
  prizes: number[],
): CalcResult {
  let targetStartScore: number | null = null;
  for (const [w, b] of pairings) {
    if (w[0] === targetPlayer) targetStartScore = w[1];
    if (b[0] === targetPlayer) targetStartScore = b[1];
  }
  if (targetStartScore === null) {
    throw new Error(`Player "${targetPlayer}" not found in pairings.`);
  }

  const baseline: Record<string, number> = {};
  const variable: Pairing[] = [];
  let trivialCount = 0;

  for (const game of pairings) {
    const [w, b, res] = game;
    const isTarget = w[0] === targetPlayer || b[0] === targetPlayer;

    // Game already finished — apply the actual result. If it's the target's
    // game, we still push it into `variable` (with a single outcome) so the
    // result lands in the right Win/Draw/Lose bucket.
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

    // Ongoing non-target game: skip if it can't possibly affect target's prize.
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
    const standings = Object.entries(finalScores).sort((a, b) => b[1] - a[1]);
    let idx = 0;
    let targetPayout = 0;
    while (idx < standings.length) {
      const score = standings[idx][1];
      const tied: string[] = [standings[idx][0]];
      let next = idx + 1;
      while (next < standings.length && standings[next][1] === score) {
        tied.push(standings[next][0]);
        next++;
      }
      let pool = 0;
      for (let r = idx; r < idx + tied.length; r++) {
        if (r < prizes.length) pool += prizes[r];
      }
      const share = pool / tied.length;
      for (const p of tied) {
        if (p === targetPlayer) targetPayout = share;
      }
      idx = next;
    }
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

  // Build a plain-language summary of which board results lead to the
  // best possible payout for the target player.
  const phrases: string[] = [];
  let targetWish: string | null = null;
  for (let i = 0; i < n; i++) {
    if (radix[i] === 1) continue; // finished game, nothing to wish for
    const game = variable[i];
    const [wName] = game[0];
    const [bName] = game[1];
    const mask = bestMasks[i];
    // bit 0 = white wins, bit 1 = draw, bit 2 = black wins
    if (mask === 0b111) continue; // any result works
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

  // Stats across outcomes for a richer recap.
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
