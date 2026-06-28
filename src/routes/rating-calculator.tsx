import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import {
  Loader2,
  Link2,
  TrendingUp,
  Sparkles,
  Calculator,
  Target,
  Plus,
  X,
  Pencil,
} from "lucide-react";
import { type StandingsPlayer } from "@/lib/extract-standings.functions";
import { scrapeStandings } from "@/lib/scrape-standings.functions";
import { fetchUscfRatings, type LiveRatingInfo } from "@/lib/fetch-uscf-ratings.functions";
import { calculateRating } from "@/lib/calculate-rating";

export const Route = createFileRoute("/rating-calculator")({
  head: () => ({
    meta: [
      { title: "USCF Rating Calculator" },
      {
        name: "description",
        content:
          "Upload tournament standings to calculate your performance rating and projected new USCF rating using live opponent ratings.",
      },
      { property: "og:title", content: "USCF Rating Calculator" },
      { property: "og:description", content: "Live USCF rating projection from a standings sheet." },
      { property: "og:url", content: "/rating-calculator" },
    ],
    links: [{ rel: "canonical", href: "/rating-calculator" }],
  }),
  component: RatingPage,
});

function resultToScore(r: string): number | null {
  if (r === "W" || r === "B") return 1;
  if (r === "D" || r === "H") return 0.5;
  if (r === "L" || r === "F") return 0;
  return null;
}

function normName(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}

function ratingColor(delta: number | undefined): {
  text: string;
  bg: string;
  border: string;
} {
  if (delta == null || Number.isNaN(delta)) {
    return { text: "inherit", bg: "transparent", border: "hsl(var(--border))" };
  }
  const clamped = Math.max(-100, Math.min(100, delta));
  const hue = 60 + (clamped / 100) * 60;
  return {
    text: `hsl(${hue}, 70%, 45%)`,
    bg: `linear-gradient(135deg, hsl(${hue}, 70%, 95%) 0%, hsl(${hue}, 70%, 90%) 100%)`,
    border: `hsl(${hue}, 60%, 70%)`,
  };
}


type GameRow = {
  round: number;
  opponent: string;
  opponentRating: number | null;
  score: number | null;
  /** True for upcoming/unplayed rounds — opponent name + rating are user-editable. */
  pending: boolean;
};

function RatingPage() {
  const scrape = useServerFn(scrapeStandings);
  const fetchRatings = useServerFn(fetchUscfRatings);

  const [mode, setMode] = useState<"standings" | "manual">("standings");

  // Standings mode state
  const [url, setUrl] = useState("");
  const [playerName, setPlayerName] = useState("");
  const [players, setPlayers] = useState<StandingsPlayer[]>([]);
  const [totalRounds, setTotalRounds] = useState(0);
  const [, setLiveRatings] = useState<Record<string, LiveRatingInfo>>({});
  const [busy, setBusy] = useState(false);
  const [calcBusy, setCalcBusy] = useState(false);

  // Manual mode state
  const [manualCurrentRating, setManualCurrentRating] = useState<string>("");

  // Shared state (rows + current rating)
  const [used, setUsed] = useState<GameRow[]>([]);
  const [skipped, setSkipped] = useState<{ opponent: string; reason: string }[]>([]);
  const [currentRatingUsed, setCurrentRatingUsed] = useState<number | null>(null);

  const resetRows = () => {
    setUsed([]);
    setSkipped([]);
    setCurrentRatingUsed(null);
  };

  const switchMode = (next: "standings" | "manual") => {
    if (next === mode) return;
    setMode(next);
    resetRows();
    if (next === "manual") {
      // Pre-seed with one empty game
      setUsed([{ round: 1, opponent: "", opponentRating: null, score: null, pending: true }]);
    }
  };

  const runExtract = async () => {
    if (!url.trim()) return toast.error("Please paste a standings URL.");
    setBusy(true);
    try {
      const { players, totalRounds } = await scrape({ data: { url: url.trim() } });
      if (!players.length) {
        toast.error("Could not read any players from that page.");
      } else {
        setPlayers(players);
        setTotalRounds(totalRounds);
        resetRows();
        setLiveRatings({});
        toast.success(`Loaded ${players.length} players · ${totalRounds} rounds.`);
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Scrape failed.");
    } finally {
      setBusy(false);
    }
  };

  const me = useMemo(() => {
    if (!playerName.trim() || !players.length) return null;
    const target = normName(playerName);
    return (
      players.find((p) => normName(p.name) === target) ??
      players.find((p) => normName(p.name).includes(target)) ??
      null
    );
  }, [players, playerName]);

  const runCalc = async () => {
    if (!players.length) return toast.error("Extract standings first.");
    if (!me) return toast.error("Couldn't find that player in the standings.");

    setCalcBusy(true);
    try {
      const byPair = new Map<number, StandingsPlayer>();
      for (const p of players) if (p.pairingNumber != null) byPair.set(p.pairingNumber, p);

      const opponentIds: string[] = [];
      for (const g of me.games) {
        if (g.opponentPairing == null) continue;
        const opp = byPair.get(g.opponentPairing);
        if (opp?.uscfId) opponentIds.push(opp.uscfId);
      }
      if (me.uscfId) opponentIds.push(me.uscfId);

      let ratingMap: Record<string, LiveRatingInfo> = {};
      if (opponentIds.length) {
        const { ratings } = await fetchRatings({ data: { uscfIds: opponentIds } });
        for (const r of ratings) ratingMap[r.uscfId] = r;
        setLiveRatings(ratingMap);
      }

      const usedRows: GameRow[] = [];
      const skippedRows: { opponent: string; reason: string }[] = [];
      const handledRounds = new Set<number>();

      for (const g of me.games) {
        const score = resultToScore(g.result);
        if (score == null) continue;
        if (g.opponentPairing == null) {
          skippedRows.push({ opponent: `Round ${g.round}`, reason: "bye / forfeit (not rated)" });
          handledRounds.add(g.round);
          continue;
        }
        const opp = byPair.get(g.opponentPairing);
        if (!opp) {
          skippedRows.push({ opponent: `#${g.opponentPairing}`, reason: "opponent not found in standings" });
          handledRounds.add(g.round);
          continue;
        }
        const live = opp.uscfId ? ratingMap[opp.uscfId]?.liveRating : null;
        const rating = live ?? opp.rating;
        if (rating == null) {
          skippedRows.push({ opponent: opp.name, reason: "no rating available" });
          handledRounds.add(g.round);
          continue;
        }
        usedRows.push({
          round: g.round,
          opponent: opp.name,
          opponentRating: rating,
          score,
          pending: false,
        });
        handledRounds.add(g.round);
      }

      // Add placeholder rows for any rounds not yet played
      for (let r = 1; r <= totalRounds; r++) {
        if (!handledRounds.has(r)) {
          usedRows.push({
            round: r,
            opponent: "",
            opponentRating: null,
            score: null,
            pending: true,
          });
        }
      }
      usedRows.sort((a, b) => a.round - b.round);

      const myLive = me.uscfId ? ratingMap[me.uscfId]?.liveRating : null;
      const currentRating = myLive ?? me.rating ?? 1500;
      setUsed(usedRows);
      setSkipped(skippedRows);
      setCurrentRatingUsed(currentRating);
    } catch (e: any) {
      toast.error(e?.message ?? "Calculation failed.");
    } finally {
      setCalcBusy(false);
    }
  };

  const calc = useMemo(() => {
    const ratingForCalc =
      mode === "manual"
        ? Number(manualCurrentRating) || null
        : currentRatingUsed;
    if (ratingForCalc == null) return null;
    const ratedGames = used
      .filter((u) => u.score != null && u.opponentRating != null && u.opponentRating > 0)
      .map((u) => ({
        opponentRating: u.opponentRating as number,
        score: u.score as number,
        opponentName: u.opponent,
      }));
    if (!ratedGames.length) return null;
    return calculateRating(ratingForCalc, ratedGames);
  }, [used, currentRatingUsed, mode, manualCurrentRating]);

  const updateRow = (idx: number, patch: Partial<GameRow>) => {
    setUsed((prev) => prev.map((u, i) => (i === idx ? { ...u, ...patch } : u)));
  };

  const addManualRow = () => {
    setUsed((prev) => [
      ...prev,
      {
        round: prev.length ? Math.max(...prev.map((p) => p.round)) + 1 : 1,
        opponent: "",
        opponentRating: null,
        score: null,
        pending: true,
      },
    ]);
  };

  const removeRow = (idx: number) => {
    setUsed((prev) => prev.filter((_, i) => i !== idx));
  };

  const showResults =
    (mode === "standings" && currentRatingUsed != null) ||
    (mode === "manual" && used.length > 0);

  return (
    <div className="min-h-screen">
      <Toaster richColors position="top-center" />
      <header className="border-b border-border/60 backdrop-blur-sm bg-card/40">
        <div className="mx-auto max-w-5xl px-4 sm:px-6 py-6 sm:py-8">
          <div className="flex items-center gap-3">
            <div
              className="grid h-12 w-12 place-items-center rounded-2xl text-primary-foreground shadow-[var(--shadow-elegant)]"
              style={{ background: "var(--gradient-hero)" }}
            >
              <TrendingUp className="h-6 w-6" />
            </div>
            <div>
              <h1
                className="text-2xl sm:text-3xl font-bold tracking-tight bg-clip-text text-transparent"
                style={{ backgroundImage: "var(--gradient-hero)" }}
              >
                USCF Rating Calculator
              </h1>
              <p className="mt-1 text-xs sm:text-sm text-muted-foreground">
                Upload standings · We pull live USCF ratings · See your performance & projected rating.
              </p>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-2 sm:px-4 py-4 sm:py-7 space-y-4">
        {/* Mode toggle */}
        <div className="flex gap-2 rounded-lg border border-border/60 bg-card/40 p-1 w-fit">
          <button
            onClick={() => switchMode("standings")}
            className={`px-3 py-1.5 rounded-md text-xs sm:text-sm font-medium transition ${
              mode === "standings"
                ? "bg-primary text-primary-foreground shadow"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            From standings URL
          </button>
          <button
            onClick={() => switchMode("manual")}
            className={`px-3 py-1.5 rounded-md text-xs sm:text-sm font-medium transition ${
              mode === "manual"
                ? "bg-primary text-primary-foreground shadow"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Manual entry
          </button>
        </div>

        {mode === "standings" && (
          <>
            {/* Step 1: standings URL */}
            <Card className="border-border/60 shadow-[var(--shadow-soft)] overflow-hidden">
              <div className="h-1" style={{ background: "var(--gradient-hero)" }} />
              <CardHeader className="px-3 py-3 sm:px-5 sm:py-4">
                <CardTitle className="text-base">
                  <h2 className="flex items-center gap-2">
                    <span className="grid h-7 w-7 place-items-center rounded-full bg-primary/15 text-primary text-xs font-bold">1</span>
                    <Link2 className="h-4 w-4 text-primary" /> Standings URL
                  </h2>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 px-3 pb-3 sm:px-5 sm:pb-5">
                <div>
                  <Label htmlFor="standings-url" className="text-xs sm:text-sm">
                    Paste your section's standings page URL
                  </Label>
                  <Input
                    id="standings-url"
                    type="url"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://chessevents.com/event/.../standings/.."
                    className="mt-1 h-8 px-2 text-xs sm:h-9 sm:text-sm"
                    autoComplete="off"
                  />
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    We scrape the standings table directly — no screenshots needed.
                  </p>
                </div>
                <Button
                  onClick={runExtract}
                  disabled={busy || !url.trim()}
                  size="sm"
                  className="text-primary-foreground border-0 shadow-[var(--shadow-elegant)] hover:opacity-90 transition-all hover:scale-[1.02] text-xs sm:text-sm"
                  style={{ background: "var(--gradient-hero)" }}
                >
                  {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                  Load standings
                </Button>
              </CardContent>
            </Card>

            {/* Step 2: name + calc */}
            {players.length > 0 && (
              <Card className="border-border/60 shadow-[var(--shadow-soft)] overflow-hidden">
                <div className="h-1" style={{ background: "var(--gradient-hero)" }} />
                <CardHeader className="px-3 py-3 sm:px-5 sm:py-4">
                  <CardTitle className="text-base">
                    <h2 className="flex items-center gap-2">
                      <span className="grid h-7 w-7 place-items-center rounded-full bg-primary/15 text-primary text-xs font-bold">2</span>
                      Your name
                    </h2>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 px-3 pb-3 sm:px-5 sm:pb-5">
                  <div>
                    <Label htmlFor="player-name" className="text-xs sm:text-sm">
                      Found {players.length} players across {totalRounds} rounds.
                    </Label>
                    <Input
                      id="player-name"
                      value={playerName}
                      onChange={(e) => setPlayerName(e.target.value)}
                      placeholder="Enter your name as it appears on the sheet"
                      className="mt-1 h-8 px-2 text-xs sm:h-9 sm:text-sm"
                      autoComplete="off"
                    />
                    {playerName && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {me
                          ? `Match: ${me.name} (USCF ${me.uscfId ?? "?"}, rating ${me.rating ?? "?"}, score ${me.score})`
                          : "No match yet."}
                      </p>
                    )}
                  </div>
                  <Button
                    onClick={runCalc}
                    disabled={!me || calcBusy}
                    size="sm"
                    className="text-primary-foreground border-0 shadow-[var(--shadow-elegant)] hover:opacity-90 transition-all hover:scale-[1.02] disabled:opacity-70 disabled:hover:scale-100 text-xs sm:text-sm"
                    style={{ background: "var(--gradient-hero)" }}
                  >
                    {calcBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Calculator className="mr-2 h-4 w-4" />}
                    {calcBusy ? "Fetching live ratings…" : "Calculate rating"}
                  </Button>
                </CardContent>
              </Card>
            )}
          </>
        )}

        {mode === "manual" && (
          <Card className="border-border/60 shadow-[var(--shadow-soft)] overflow-hidden">
            <div className="h-1" style={{ background: "var(--gradient-hero)" }} />
            <CardHeader className="px-3 py-3 sm:px-5 sm:py-4">
              <CardTitle className="text-base">
                <h2 className="flex items-center gap-2">
                  <Pencil className="h-4 w-4 text-primary" /> Manual entry
                </h2>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 px-3 pb-3 sm:px-5 sm:pb-5">
              <div className="max-w-xs">
                <Label htmlFor="manual-rating" className="text-xs sm:text-sm">
                  Your current rating
                </Label>
                <Input
                  id="manual-rating"
                  type="number"
                  value={manualCurrentRating}
                  onChange={(e) => setManualCurrentRating(e.target.value)}
                  placeholder="e.g. 1650"
                  className="mt-1 h-8 px-2 text-xs sm:h-9 sm:text-sm"
                  autoComplete="off"
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                Add a row per opponent below. Enter their rating and your result.
              </p>
            </CardContent>
          </Card>
        )}

        {/* Results / Games table */}
        {showResults && (
          <Card className="border-border/60 shadow-[var(--shadow-elegant)] overflow-hidden">
            <div className="h-1.5" style={{ background: "var(--gradient-hero)" }} />
            <CardHeader className="px-3 py-3 sm:px-5 sm:py-4">
              <CardTitle className="text-base">
                <h2 className="flex items-center gap-2">
                  <Target className="h-4 w-4 text-accent" /> Results
                </h2>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 px-3 pb-3 sm:px-5 sm:pb-5">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <Stat
                  label="Current rating"
                  value={
                    (mode === "manual"
                      ? Number(manualCurrentRating) || null
                      : currentRatingUsed)?.toString() ?? "—"
                  }
                />
                <Stat label="Avg opp rating" value={calc?.avgOpponentRating.toString() ?? "—"} />
                <Stat
                  label="Performance"
                  value={calc?.performanceRating?.toString() ?? "—"}
                  accent
                />
                <Stat
                  label="Projected new rating"
                  value={calc?.newRating.toString() ?? "—"}
                  accent
                  sub={
                    calc
                      ? `${calc.ratingChange >= 0 ? "+" : ""}${calc.ratingChange}`
                      : undefined
                  }
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <h3 className="text-sm font-semibold">Games</h3>
                  {mode === "manual" && (
                    <Button
                      onClick={addManualRow}
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                    >
                      <Plus className="mr-1 h-3.5 w-3.5" /> Add round
                    </Button>
                  )}
                </div>
                <div className="rounded-lg border border-border/60 overflow-x-auto">
                  <table className="w-full text-xs sm:text-sm">
                    <thead className="bg-muted/50 text-muted-foreground">
                      <tr>
                        <th className="text-left px-2 py-1.5 w-14">Round</th>
                        <th className="text-left px-2 py-1.5">Opponent</th>
                        <th className="text-right px-2 py-1.5 w-24">Rating</th>
                        <th className="text-right px-2 py-1.5 w-20">Score</th>
                        {mode === "manual" && <th className="w-8" />}
                      </tr>
                    </thead>
                    <tbody>
                      {used.map((g, i) => (
                        <tr
                          key={i}
                          className={`border-t border-border/40 ${g.pending ? "bg-muted/20" : ""}`}
                        >
                          <td className="px-2 py-1.5 tabular-nums">{g.round}</td>
                          <td className="px-2 py-1.5">
                            {g.pending ? (
                              <Input
                                value={g.opponent}
                                onChange={(e) => updateRow(i, { opponent: e.target.value })}
                                placeholder="Opponent name (optional)"
                                className="h-7 px-2 text-xs sm:text-sm"
                              />
                            ) : (
                              g.opponent
                            )}
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums">
                            {g.pending ? (
                              <Input
                                type="number"
                                value={g.opponentRating ?? ""}
                                onChange={(e) =>
                                  updateRow(i, {
                                    opponentRating: e.target.value
                                      ? Number(e.target.value)
                                      : null,
                                  })
                                }
                                placeholder="Rating"
                                className="h-7 px-2 text-xs sm:text-sm text-right tabular-nums"
                              />
                            ) : (
                              g.opponentRating
                            )}
                          </td>
                          <td className="px-2 py-1.5 text-right">
                            <select
                              value={g.score == null ? "" : String(g.score)}
                              onChange={(e) =>
                                updateRow(i, {
                                  score: e.target.value === "" ? null : parseFloat(e.target.value),
                                })
                              }
                              className="h-7 rounded-md border border-border/60 bg-background px-1.5 text-xs tabular-nums"
                              aria-label={`Round ${g.round} score`}
                            >
                              <option value="">—</option>
                              <option value="1">1</option>
                              <option value="0.5">½</option>
                              <option value="0">0</option>
                            </select>
                          </td>
                          {mode === "manual" && (
                            <td className="px-1 py-1.5 text-right">
                              <button
                                onClick={() => removeRow(i)}
                                className="text-muted-foreground hover:text-destructive transition"
                                aria-label="Remove round"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </td>
                          )}
                        </tr>
                      ))}
                      {used.length === 0 && (
                        <tr>
                          <td
                            colSpan={mode === "manual" ? 5 : 4}
                            className="px-2 py-4 text-center text-muted-foreground text-xs"
                          >
                            No games yet.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                {used.some((u) => u.pending) && (
                  <p className="mt-1.5 text-[11px] text-muted-foreground">
                    Highlighted rows are upcoming/unplayed — fill in the opponent rating and
                    pick a result to see how each affects your projection.
                  </p>
                )}
              </div>

              {skipped.length > 0 && (
                <div className="text-xs text-muted-foreground">
                  <span className="font-semibold">Skipped:</span>{" "}
                  {skipped.map((s, i) => (
                    <span key={i}>
                      {s.opponent} ({s.reason}){i < skipped.length - 1 ? "; " : ""}
                    </span>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-card p-2.5">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-0.5 text-lg sm:text-xl font-bold tabular-nums ${accent ? "text-primary" : ""}`}>
        {value}
      </div>
      {sub && <div className="text-xs text-muted-foreground tabular-nums">{sub}</div>}
    </div>
  );
}
