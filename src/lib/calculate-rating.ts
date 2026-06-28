/**
 * USCF rating math (regular).
 *
 * Implements:
 *  - Performance rating: iterative solve for R such that
 *      sum_i 1/(1 + 10^((R_i - R)/400)) = actual score
 *  - Projected new rating using the standard USCF update with bonus.
 *    Bonus constant overridden to 10 (instead of the published 14)
 *    per project requirement.
 */

export type RatedGame = {
  opponentRating: number;
  /** score this game: 1 for win, 0.5 for draw, 0 for loss */
  score: number;
  opponentName?: string;
};

export type RatingCalc = {
  gamesUsed: number;
  totalScore: number;
  avgOpponentRating: number;
  expectedScore: number;
  performanceRating: number | null;
  newRating: number;
  ratingChange: number;
  bonusApplied: number;
  kFactor: number;
};

function expectedScoreFor(rating: number, opponents: number[]): number {
  let e = 0;
  for (const r of opponents) {
    e += 1 / (1 + Math.pow(10, (r - rating) / 400));
  }
  return e;
}

/** Bisection solve for performance rating. Returns null when score is 0 or N (undefined). */
function performanceRating(games: RatedGame[]): number | null {
  if (!games.length) return null;
  const score = games.reduce((s, g) => s + g.score, 0);
  if (score <= 0 || score >= games.length) return null; // performance is +/- infinity
  const opponents = games.map((g) => g.opponentRating);
  let lo = 0;
  let hi = 3500;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const e = expectedScoreFor(mid, opponents);
    if (e < score) lo = mid;
    else hi = mid;
  }
  return Math.round((lo + hi) / 2);
}

/**
 * Established-player K factor approximation:
 *   K = 800 / (Ne + m), where Ne ≈ prior effective games.
 * We don't know Ne from the standings sheet alone, so we estimate from current
 * rating (higher rated players typically have many more rated games).
 */
function effectiveNFromRating(currentRating: number): number {
  // Rough heuristic: a player rated R likely has at least this many games.
  if (currentRating >= 2200) return 50;
  if (currentRating >= 1800) return 40;
  if (currentRating >= 1400) return 30;
  if (currentRating >= 1000) return 20;
  return 10;
}

export function calculateRating(
  currentRating: number,
  games: RatedGame[],
): RatingCalc {
  const m = games.length;
  const totalScore = games.reduce((s, g) => s + g.score, 0);
  const avgOpp = m ? games.reduce((s, g) => s + g.opponentRating, 0) / m : 0;
  const expected = m ? expectedScoreFor(currentRating, games.map((g) => g.opponentRating)) : 0;

  const Ne = effectiveNFromRating(currentRating);
  const K = m ? 800 / (Ne + m) : 0;
  const base = K * (totalScore - expected);
  // USCF bonus: max(0, K*(S-E) - B*sqrt(max(m,4))) with B = 10 (per project setting).
  const B = 10;
  const bonus = m ? Math.max(0, base - B * Math.sqrt(Math.max(m, 4))) : 0;
  const change = base + bonus;
  const newRating = Math.round(currentRating + change);

  return {
    gamesUsed: m,
    totalScore,
    avgOpponentRating: Math.round(avgOpp),
    expectedScore: expected,
    performanceRating: performanceRating(games),
    newRating,
    ratingChange: Math.round(change),
    bonusApplied: Math.round(bonus),
    kFactor: K,
  };
}
