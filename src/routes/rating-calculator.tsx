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
} from "lucide-react";
import { type StandingsPlayer } from "@/lib/extract-standings.functions";
import { scrapeStandings } from "@/lib/scrape-standings.functions";
import { fetchUscfRatings, type LiveRatingInfo } from "@/lib/fetch-uscf-ratings.functions";
import { calculateRating, type RatedGame, type RatingCalc } from "@/lib/calculate-rating";

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

function RatingPage() {
  const scrape = useServerFn(scrapeStandings);
  const fetchRatings = useServerFn(fetchUscfRatings);

  const [url, setUrl] = useState("");
  const [playerName, setPlayerName] = useState("");
  const [players, setPlayers] = useState<StandingsPlayer[]>([]);
  const [, setLiveRatings] = useState<Record<string, LiveRatingInfo>>({});
  const [result, setResult] = useState<{
    calc: RatingCalc;
    used: { opponent: string; opponentRating: number; score: number; source: "live" | "official" }[];
    skipped: { opponent: string; reason: string }[];
    currentRatingUsed: number;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [calcBusy, setCalcBusy] = useState(false);

  const runExtract = async () => {
    if (!url.trim()) return toast.error("Please paste a standings URL.");
    setBusy(true);
    try {
      const { players } = await scrape({ data: { url: url.trim() } });
      if (!players.length) {
        toast.error("Could not read any players from that page.");
      } else {
        setPlayers(players);
        setResult(null);
        setLiveRatings({});
        toast.success(`Loaded ${players.length} players.`);
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
      // Build a pairing# -> player map
      const byPair = new Map<number, StandingsPlayer>();
      for (const p of players) if (p.pairingNumber != null) byPair.set(p.pairingNumber, p);

      // Collect opponents that need live ratings
      const opponentIds: string[] = [];
      for (const g of me.games) {
        if (g.opponentPairing == null) continue;
        const opp = byPair.get(g.opponentPairing);
        if (opp?.uscfId) opponentIds.push(opp.uscfId);
      }
      // Also fetch the user's own live rating
      if (me.uscfId) opponentIds.push(me.uscfId);

      let ratingMap: Record<string, LiveRatingInfo> = {};
      if (opponentIds.length) {
        const { ratings } = await fetchRatings({ data: { uscfIds: opponentIds } });
        for (const r of ratings) ratingMap[r.uscfId] = r;
        setLiveRatings(ratingMap);
      }

      const used: { opponent: string; opponentRating: number; score: number; source: "live" | "official" }[] = [];
      const skipped: { opponent: string; reason: string }[] = [];
      const ratedGames: RatedGame[] = [];

      for (const g of me.games) {
        const score = resultToScore(g.result);
        if (score == null) continue; // unplayed / bye
        if (g.opponentPairing == null) {
          skipped.push({ opponent: `Round ${g.round}`, reason: "bye / forfeit (not rated)" });
          continue;
        }
        const opp = byPair.get(g.opponentPairing);
        if (!opp) {
          skipped.push({ opponent: `#${g.opponentPairing}`, reason: "opponent not found in standings" });
          continue;
        }
        const live = opp.uscfId ? ratingMap[opp.uscfId]?.liveRating : null;
        const rating = live ?? opp.rating;
        if (rating == null) {
          skipped.push({ opponent: opp.name, reason: "no rating available" });
          continue;
        }
        ratedGames.push({ opponentRating: rating, score, opponentName: opp.name });
        used.push({
          opponent: opp.name,
          opponentRating: rating,
          score,
          source: live != null ? "live" : "official",
        });
      }

      if (!ratedGames.length) {
        toast.error("No rated games available to compute a rating.");
        setCalcBusy(false);
        return;
      }

      const myLive = me.uscfId ? ratingMap[me.uscfId]?.liveRating : null;
      const currentRating = myLive ?? me.rating ?? 1500;
      const calc = calculateRating(currentRating, ratedGames);
      setResult({ calc, used, skipped, currentRatingUsed: currentRating });
    } catch (e: any) {
      toast.error(e?.message ?? "Calculation failed.");
    } finally {
      setCalcBusy(false);
    }
  };

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
        {/* Step 1: upload */}
        <Card className="border-border/60 shadow-[var(--shadow-soft)] overflow-hidden">
          <div className="h-1" style={{ background: "var(--gradient-hero)" }} />
          <CardHeader className="px-3 py-3 sm:px-5 sm:py-4">
            <CardTitle className="text-base">
              <h2 className="flex items-center gap-2">
                <span className="grid h-7 w-7 place-items-center rounded-full bg-primary/15 text-primary text-xs font-bold">1</span>
                <Upload className="h-4 w-4 text-primary" /> Upload standings sheet(s)
              </h2>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 px-3 pb-3 sm:px-5 sm:pb-5">
            <div>
              <Label htmlFor="standings-images" className="text-xs sm:text-sm">
                Standings image(s) — you can select multiple pages
              </Label>
              <Input
                id="standings-images"
                type="file"
                accept="image/*"
                multiple
                aria-label="Upload standings images"
                onChange={(e) => onFiles(e.target.files)}
                className="cursor-pointer mt-1 h-8 px-2 text-xs sm:h-9 sm:text-sm file:text-xs sm:file:text-sm"
              />
            </div>
            {previews.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {previews.map((src, i) => (
                  <div key={i} className="relative group">
                    <img
                      src={src}
                      alt={`Standings page ${i + 1}`}
                      className="max-h-40 w-full rounded-lg border border-border/60 object-contain shadow-[var(--shadow-soft)]"
                    />
                    <button
                      onClick={() => removeFile(i)}
                      className="absolute top-1 right-1 rounded-full bg-background/90 border border-border p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                      aria-label={`Remove image ${i + 1}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <Button
              onClick={runExtract}
              disabled={busy || !files.length}
              size="sm"
              className="text-primary-foreground border-0 shadow-[var(--shadow-elegant)] hover:opacity-90 transition-all hover:scale-[1.02] text-xs sm:text-sm"
              style={{ background: "var(--gradient-hero)" }}
            >
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
              Extract standings with AI
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
                  Found {players.length} players in the standings.
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

        {/* Step 3: result */}
        {result && (
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
                <Stat label="Current rating" value={result.currentRatingUsed.toString()} />
                <Stat
                  label="Performance"
                  value={result.calc.performanceRating?.toString() ?? "—"}
                  accent
                />
                <Stat
                  label="Projected new rating"
                  value={result.calc.newRating.toString()}
                  accent
                  sub={`${result.calc.ratingChange >= 0 ? "+" : ""}${result.calc.ratingChange}`}
                />
                <Stat
                  label="Score / Expected"
                  value={`${result.calc.totalScore} / ${result.calc.expectedScore.toFixed(2)}`}
                />
              </div>

              <div className="text-xs text-muted-foreground">
                K = {result.calc.kFactor.toFixed(1)} · Bonus applied: {result.calc.bonusApplied} ·
                Avg opp rating: {result.calc.avgOpponentRating} · Games used: {result.calc.gamesUsed}
              </div>

              <div>
                <h3 className="text-sm font-semibold mb-1.5">Games used</h3>
                <div className="rounded-lg border border-border/60 overflow-hidden">
                  <table className="w-full text-xs sm:text-sm">
                    <thead className="bg-muted/50 text-muted-foreground">
                      <tr>
                        <th className="text-left px-2 py-1.5">Opponent</th>
                        <th className="text-right px-2 py-1.5">Rating</th>
                        <th className="text-right px-2 py-1.5">Source</th>
                        <th className="text-right px-2 py-1.5">Score</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.used.map((g, i) => (
                        <tr key={i} className="border-t border-border/40">
                          <td className="px-2 py-1.5">{g.opponent}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{g.opponentRating}</td>
                          <td className="px-2 py-1.5 text-right text-xs">
                            <span className={g.source === "live" ? "text-success" : "text-muted-foreground"}>
                              {g.source}
                            </span>
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums">
                            {g.score === 1 ? "1" : g.score === 0 ? "0" : "½"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {result.skipped.length > 0 && (
                <div className="text-xs text-muted-foreground">
                  <span className="font-semibold">Skipped:</span>{" "}
                  {result.skipped.map((s, i) => (
                    <span key={i}>
                      {s.opponent} ({s.reason}){i < result.skipped.length - 1 ? "; " : ""}
                    </span>
                  ))}
                </div>
              )}

              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Performance rating is the rating at which your expected score equals your actual score
                (USCF/FIDE iterative method). Projected new rating uses the USCF standard formula with
                bonus constant set to 10. Live ratings are pulled from the USCF ratings API; opponents
                without a USCF ID fall back to the rating shown on the standings sheet.
              </p>
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
