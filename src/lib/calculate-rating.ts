/**
 * USCF rating math (regular) — approximating formulas from
 * https://www.glicko.net/ratings/approx.pdf
 *
 * Standard formula:
 *   Nr   = 50 / sqrt(0.662 + 0.00000739 * (2569 - Rpre)^2)   (capped: Nr = 50 if Rpre >= 2355)
 *   Ne   = min(N, Nr)                                         (N = prior games count)
 *   K    = 800 / (Ne + m)
 *   We   = 1 / (10^(-(Rpre - Ropp) / 400) + 1)
 *   E    = sum of We over opponents
 *   B    = max(0, K*(S - E) - T*sqrt(m'))   where m' = max(m, 4)
 *   Rpost = Rpre + K*(S - E) + B
 *
 * The bonus threshold T is published as 14, but this project overrides
 * it to 10 per requirement.
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

/** Winning expectancy for a single opponent. */
function winExpectancy(rating: number, opponent: number): number {
  return 1 / (Math.pow(10, -(rating - opponent) / 400) + 1);
}

function expectedScoreFor(rating: number, opponents: number[]): number {
  let e = 0;
  for (const r of opponents) e += winExpectancy(rating, r);
  return e;
}

/** Bisection solve for performance rating. Returns null when score is 0 or m (undefined). */
function performanceRating(games: RatedGame[]): number | null {
  if (!games.length) return null;
  const score = games.reduce((s, g) => s + g.score, 0);
  if (score <= 0 || score >= games.length) return null;
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
 * Effective games (Nr) per the USCF approximating formulas.
 * Without knowing prior game count N, Ne = Nr (the conservative cap).
 */
function effectiveGames(Rpre: number): number {
  if (Rpre >= 2355) return 50;
  const nr = 50 / Math.sqrt(0.662 + 0.00000739 * Math.pow(2569 - Rpre, 2));
  return Math.min(50, nr);
}

export function calculateRating(
  currentRating: number,
  games: RatedGame[],
): RatingCalc {
  const m = games.length;
  const totalScore = games.reduce((s, g) => s + g.score, 0);
  const avgOpp = m ? games.reduce((s, g) => s + g.opponentRating, 0) / m : 0;
  const opponents = games.map((g) => g.opponentRating);
  const expected = m ? expectedScoreFor(currentRating, opponents) : 0;

  const Ne = effectiveGames(currentRating);
  const K = m ? 800 / (Ne + m) : 0;
  const base = K * (totalScore - expected);

  // Bonus: B = max(0, K(S-E) - T*sqrt(m')), m' = max(m, 4). T overridden to 10.
  const T = 10;
  const mPrime = Math.max(m, 4);
  const bonus = m >= 3 ? Math.max(0, base - T * Math.sqrt(mPrime)) : 0;
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
