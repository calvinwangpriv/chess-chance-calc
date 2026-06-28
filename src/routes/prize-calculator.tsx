import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { Loader2, Upload, Trophy, Calculator, Sparkles, Crown } from "lucide-react";
import { extractPairings, type Pairing, type GameResult } from "@/lib/extract-pairings.functions";
import { calculatePayouts, parseClassPrizes, type CalcResult } from "@/lib/calculate-payouts";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/prize-calculator")({
  head: () => ({
    meta: [
      { title: "Chess Prize Odds Calculator" },
      {
        name: "description",
        content:
          "Upload a SwissSys final-round pairing sheet to calculate your win/draw/lose prize odds.",
      },
      { property: "og:title", content: "Chess Prize Odds Calculator" },
      {
        property: "og:description",
        content:
          "Upload a SwissSys pairing sheet and instantly see your expected prize money for each result.",
      },
      { property: "og:url", content: "/" },
    ],
    links: [{ rel: "canonical", href: "/" }],
  }),
  component: Index,
});

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

const outcomeStyles: Record<
  "Win" | "Draw" | "Lose",
  { ring: string; chip: string; bar: string; icon: string }
> = {
  Win: {
    ring: "ring-success/30",
    chip: "bg-success/15 text-success border border-success/30",
    bar: "bg-gradient-to-r from-success to-primary-glow",
    icon: "🏆",
  },
  Draw: {
    ring: "ring-warning/30",
    chip: "bg-warning/20 text-accent-foreground border border-warning/40",
    bar: "bg-gradient-to-r from-warning to-accent-glow",
    icon: "🤝",
  },
  Lose: {
    ring: "ring-destructive/30",
    chip: "bg-destructive/15 text-destructive border border-destructive/30",
    bar: "bg-gradient-to-r from-destructive to-warning",
    icon: "💀",
  },
};

function Index() {
  const extract = useServerFn(extractPairings);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string>("");
  const [prizes, setPrizes] = useState("");
  const [classPrizesText, setClassPrizesText] = useState("");
  const [targetPlayer, setTargetPlayer] = useState("");
  const [pairings, setPairings] = useState<Pairing[]>([]);
  const [result, setResult] = useState<CalcResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [calcBusy, setCalcBusy] = useState(false);


  const onFile = async (f: File | null) => {
    setImageFile(f);
    setResult(null);
    setPairings([]);
    if (f) setImagePreview(await fileToDataUrl(f));
    else setImagePreview("");
  };

  const runExtract = async () => {
    if (!imagePreview) return toast.error("Please upload a pairing image first.");
    setBusy(true);
    try {
      const { pairings } = await extract({ data: { imageDataUrl: imagePreview } });
      if (!pairings.length) {
        toast.error("Could not read any pairings from the image.");
      } else {
        setPairings(pairings);
        toast.success(`Extracted ${pairings.length} pairings.`);
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Extraction failed.");
    } finally {
      setBusy(false);
    }
  };

  const runCalc = async () => {
    if (!pairings.length) return toast.error("Extract pairings first.");
    if (!targetPlayer.trim()) return toast.error("Enter your player name.");
    const prizeSource = prizes.trim() || "12000, 6000, 3000, 1500, 1000, 800, 600, 500, 400, 400";
    const prizeArr = prizeSource
      .split(/[,\n]/)
      .map((s) => Number(s.trim().replace(/[^\d.]/g, "")))
      .filter((n) => !Number.isNaN(n) && n > 0);
    if (!prizeArr.length) return toast.error("Enter at least one prize.");
    setCalcBusy(true);
    try {
      // Yield to the browser so the spinner can paint before the heavy sync loop.
      await new Promise((r) => setTimeout(r, 30));
      const classPrizes = parseClassPrizes(classPrizesText);
      const r = calculatePayouts(pairings, targetPlayer.trim(), prizeArr, classPrizes);
      setResult(r);

    } catch (e: any) {
      toast.error(e?.message ?? "Calculation failed.");
    } finally {
      setCalcBusy(false);
    }
  };

  const updatePairing = (
    i: number,
    field: "wn" | "ws" | "wr" | "bn" | "bs" | "br" | "res",
    value: string,
  ) => {
    setPairings((prev) => {
      const next: Pairing[] = prev.map((p) => [
        [p[0][0], p[0][1], p[0][2]],
        [p[1][0], p[1][1], p[1][2]],
        p[2],
        p[3] ?? null,
      ]);

      const g = next[i];
      const ratingVal = value.trim() === "" ? null : Number(value);
      if (field === "wn") g[0][0] = value;
      else if (field === "ws") g[0][1] = Number(value);
      else if (field === "wr") g[0][2] = ratingVal;
      else if (field === "bn") g[1][0] = value;
      else if (field === "bs") g[1][1] = Number(value);
      else if (field === "br") g[1][2] = ratingVal;
      else g[2] = (value === "none" ? null : (value as GameResult));
      return next;
    });
  };

  return (
    <div className="min-h-screen">
      <Toaster richColors position="top-center" />
      <header className="border-b border-border/60 backdrop-blur-sm bg-card/40">
        <div className="mx-auto max-w-5xl px-4 sm:px-6 py-8 sm:py-10">
          <div className="flex items-center gap-4">
            <div
              className="grid h-14 w-14 place-items-center rounded-2xl text-primary-foreground shadow-[var(--shadow-elegant)]"
              style={{ background: "var(--gradient-hero)" }}
            >
              <Trophy className="h-7 w-7" />
            </div>
            <div>
              <h1 className="text-2xl sm:text-4xl font-bold tracking-tight bg-clip-text text-transparent"
                  style={{ backgroundImage: "var(--gradient-hero)" }}>
                Chess Prize Odds
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Upload a SwissSys pairing sheet · Enter the prize list · See exactly what you stand to win.
              </p>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-2 sm:px-4 py-4 sm:py-7 space-y-4">
        <Card className="border-border/60 shadow-[var(--shadow-soft)] overflow-hidden">
          <div className="h-1" style={{ background: "var(--gradient-hero)" }} />
          <CardHeader className="px-3 py-3 sm:px-5 sm:py-4">
            <CardTitle className="text-base">
              <h2 className="flex items-center gap-2">
                <span className="grid h-7 w-7 place-items-center rounded-full bg-primary/15 text-primary text-xs font-bold">1</span>
                <Upload className="h-4 w-4 text-primary" /> Upload pairing sheet
              </h2>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 px-3 pb-3 sm:px-5 sm:pb-5">
            <div>
              <Label htmlFor="pairing-image" className="text-xs sm:text-sm">Pairing sheet image</Label>
              <Input
                id="pairing-image"
                type="file"
                accept="image/*"
                aria-label="Upload pairing sheet image"
                onChange={(e) => onFile(e.target.files?.[0] ?? null)}
                className="cursor-pointer mt-1 h-8 px-2 text-xs sm:h-9 sm:text-sm file:text-xs sm:file:text-sm"
              />
            </div>
            {imagePreview && (
              <img
                src={imagePreview}
                alt="Pairing preview"
                className="max-h-64 rounded-lg border border-border/60 object-contain shadow-[var(--shadow-soft)]"
              />
            )}
            <Button
              onClick={runExtract}
              disabled={busy || !imageFile}
              size="sm"
              className="text-primary-foreground border-0 shadow-[var(--shadow-elegant)] hover:opacity-90 transition-all hover:scale-[1.02] text-xs sm:text-sm"
              style={{ background: "var(--gradient-hero)" }}
            >
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
              Extract pairings with AI
            </Button>
          </CardContent>

        </Card>

        {pairings.length > 0 && (
          <Card className="border-border/60 shadow-[var(--shadow-soft)] overflow-hidden">
            <div className="h-1" style={{ background: "var(--gradient-hero)" }} />
            <CardHeader className="px-3 py-3 sm:px-5 sm:py-4">
              <CardTitle className="text-base">
                <h2 className="flex items-center gap-2">
                  <span className="grid h-7 w-7 place-items-center rounded-full bg-primary/15 text-primary text-xs font-bold">2</span>
                  Verify extracted pairings ({pairings.length})
                </h2>
              </CardTitle>

            </CardHeader>
            <CardContent className="px-2 pb-3 sm:px-5 sm:pb-5">
              <div className="space-y-2">
                {pairings.map((p, i) => (
                  <div
                    key={i}
                    className="rounded-lg border border-border/60 bg-card p-1.5 sm:p-3 hover:bg-muted/20 transition-colors"
                  >
                    <div className="flex items-center gap-1.5 mb-1.5 sm:gap-2 sm:mb-2">
                      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary/15 text-primary text-xs font-bold tabular-nums">
                        {i + 1}
                      </span>
                      <span className="text-xs uppercase tracking-wider text-muted-foreground">
                        Board {p[3] ?? "?"}
                      </span>

                    </div>

                    <div>
                      <div className="grid grid-cols-[minmax(0,1fr)_4.5rem_minmax(0,1fr)] sm:grid-cols-[minmax(0,1fr)_110px_minmax(0,1fr)] gap-1 sm:gap-2 items-center">
                        <Input
                          aria-label={`Board ${i + 1} white player name`}
                          placeholder="White"
                          value={p[0][0]}
                          className="min-w-0 h-8 px-2 text-xs sm:h-9 sm:text-sm"
                          onChange={(e) => updatePairing(i, "wn", e.target.value)}
                        />
                        <Select
                          value={p[2] ?? "none"}
                          onValueChange={(v) => updatePairing(i, "res", v)}
                        >
                          <SelectTrigger aria-label={`Board ${i + 1} result`} className="h-8 px-2 text-xs sm:h-9 sm:text-sm">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">---</SelectItem>
                            <SelectItem value="1-0">1-0</SelectItem>
                            <SelectItem value="1/2">0.5-0.5</SelectItem>
                            <SelectItem value="0-1">0-1</SelectItem>
                          </SelectContent>
                        </Select>
                        <Input
                          aria-label={`Board ${i + 1} black player name`}
                          placeholder="Black"
                          value={p[1][0]}
                          className="min-w-0 h-8 px-2 text-xs sm:h-9 sm:text-sm"
                          onChange={(e) => updatePairing(i, "bn", e.target.value)}
                        />
                      </div>
                      <div className="grid grid-cols-[minmax(0,1fr)_4.5rem_minmax(0,1fr)] sm:grid-cols-[minmax(0,1fr)_110px_minmax(0,1fr)] gap-1 sm:gap-2 mt-1 sm:mt-2">
                        <div className="grid grid-cols-2 gap-1 sm:gap-2">
                          <Input
                            aria-label={`Board ${i + 1} white rating`}
                            type="number"
                            placeholder="Rating"
                            value={p[0][2] ?? ""}
                            className="min-w-0 h-8 px-2 text-xs sm:h-9 sm:text-sm"
                            onChange={(e) => updatePairing(i, "wr", e.target.value)}
                          />
                          <Input
                            aria-label={`Board ${i + 1} white score`}
                            type="number"
                            step="0.5"
                            placeholder="Score"
                            value={p[0][1]}
                            className="min-w-0 h-8 px-2 text-xs sm:h-9 sm:text-sm"
                            onChange={(e) => updatePairing(i, "ws", e.target.value)}
                          />
                        </div>
                        <div />
                        <div className="grid grid-cols-2 gap-1 sm:gap-2">
                          <Input
                            aria-label={`Board ${i + 1} black rating`}
                            type="number"
                            placeholder="Rating"
                            value={p[1][2] ?? ""}
                            className="min-w-0 h-8 px-2 text-xs sm:h-9 sm:text-sm"
                            onChange={(e) => updatePairing(i, "br", e.target.value)}
                          />
                          <Input
                            aria-label={`Board ${i + 1} black score`}
                            type="number"
                            step="0.5"
                            placeholder="Score"
                            value={p[1][1]}
                            className="min-w-0 h-8 px-2 text-xs sm:h-9 sm:text-sm"
                            onChange={(e) => updatePairing(i, "bs", e.target.value)}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}


        {pairings.length > 0 && (
          <Card className="border-border/60 shadow-[var(--shadow-soft)] overflow-hidden">
            <div className="h-1" style={{ background: "var(--gradient-hero)" }} />
            <CardHeader className="px-3 py-3 sm:px-5 sm:py-4">
              <CardTitle className="text-base">
                <h2 className="flex items-center gap-2">
                  <span className="grid h-7 w-7 place-items-center rounded-full bg-primary/15 text-primary text-xs font-bold">3</span>
                  Prize list &amp; your name
                </h2>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 px-3 pb-3 sm:px-5 sm:pb-5">
              <div>
                <Label htmlFor="prizes" className="text-xs sm:text-sm">Prize list (1st, 2nd, 3rd, …)</Label>
                <Input
                  id="prizes"
                  value={prizes}
                  onChange={(e) => setPrizes(e.target.value)}
                  placeholder="Ex: 12000, 6000, 3000, 1500, 1000, 800, 600, 500, 400, 400"
                  className="mt-1 h-8 px-2 text-xs sm:h-9 sm:text-sm"
                />
              </div>
              <div>
                <Label htmlFor="class-prizes" className="text-xs sm:text-sm">
                  Subsection prize list (optional)
                </Label>
                <Textarea
                  id="class-prizes"
                  value={classPrizesText}
                  onChange={(e) => setClassPrizesText(e.target.value)}
                  placeholder={"Ex: U2000: 600, 400, 200"}
                  className="mt-1 px-2 py-1.5 text-xs sm:text-sm min-h-0"
                  rows={Math.max(1, classPrizesText.split("\n").length)}
                />
              </div>
              <div>
                <Label htmlFor="player" className="text-xs sm:text-sm">Your name</Label>
                <Input
                  id="player"
                  value={targetPlayer}
                  onChange={(e) => setTargetPlayer(e.target.value)}
                  className="mt-1 h-8 px-2 text-xs sm:h-9 sm:text-sm"
                  autoComplete="off"
                />
              </div>
              <Button
                onClick={runCalc}
                disabled={!pairings.length || calcBusy}
                size="sm"
                className="text-primary-foreground border-0 shadow-[var(--shadow-elegant)] hover:opacity-90 transition-all hover:scale-[1.02] disabled:opacity-70 disabled:hover:scale-100 text-xs sm:text-sm"
                style={{ background: "var(--gradient-hero)" }}
              >
                {calcBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Calculator className="mr-2 h-4 w-4" />}
                {calcBusy ? "Calculating…" : "Calculate odds"}
              </Button>
            </CardContent>

          </Card>
        )}

        {result && (
          <Card className="mx-auto w-full max-w-[30rem] border-border/60 shadow-[var(--shadow-elegant)] overflow-hidden">
            <div className="h-1.5" style={{ background: "var(--gradient-hero)" }} />
            <CardHeader className="px-2.5 py-2 sm:px-4 sm:py-3">
              <CardTitle className="text-base">
                <h2 className="flex items-center gap-2">
                  <Trophy className="h-4 w-4 text-accent" />
                  Results
                </h2>
              </CardTitle>

            </CardHeader>
            <CardContent className="space-y-2 px-2 pb-2 sm:px-4 sm:pb-4">

              <div
                className="rounded-lg border border-accent/40 p-2 sm:p-3 flex gap-2 items-start"
                style={{ background: "color-mix(in oklab, var(--accent) 12%, var(--card))" }}
              >
                <Crown className="h-5 w-5 text-accent shrink-0 mt-0.5" />
                <div>
                  <div className="text-xs uppercase tracking-wider font-semibold text-accent-foreground/80 mb-1">
                    What you're rooting for
                  </div>
                  <p className="text-xs sm:text-sm leading-relaxed">{result.bestSummary}</p>

                </div>
              </div>


              {result.outcomes.map((o) => {
                const s = outcomeStyles[o.outcome];
                return (
                    <div key={o.outcome} className={`rounded-lg border border-border/60 p-2 ring-1 ${s.ring} bg-card`}>
                    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 mb-2">
                        <h2 className="font-semibold text-sm sm:text-base flex items-center gap-1.5 min-w-0">
                          <span className="text-lg sm:text-xl">{s.icon}</span>
                        If you {o.outcome.toLowerCase()}:
                      </h2>
                      <span className={`shrink-0 text-[10px] sm:text-xs px-2 py-1 rounded-full font-medium tabular-nums ${s.chip}`}>
                        {o.totalScenarios.toLocaleString()} scenarios
                      </span>
                    </div>
                    {o.totalScenarios === 0 ? (
                      <p className="text-sm text-muted-foreground">No scenarios.</p>
                    ) : o.exactPayout !== undefined ? (
                      <p className="text-sm">
                        100% chance of exactly{" "}
                        <span className="font-semibold text-primary">${o.exactPayout}</span>
                      </p>
                    ) : (
                      <div className="space-y-1">
                        {[...o.bins].reverse().map((b, idx) => (
                        <div key={idx} className="grid grid-cols-[2.25rem_1fr_5.5rem_3.5rem] sm:grid-cols-[2.5rem_1fr_6rem_4rem] items-center gap-1 text-[11px] sm:text-xs">
                            <div className="text-right tabular-nums font-semibold">
                              {b.percent.toFixed(1)}%
                            </div>
                            <div className="h-2 bg-muted rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all ${s.bar}`}
                                style={{ width: `${b.percent}%` }}
                              />
                            </div>
                            <div className="text-right tabular-nums font-medium text-foreground whitespace-nowrap">
                              ${b.start}–${b.end}
                            </div>
                            <div className="text-right text-muted-foreground tabular-nums text-[10px] sm:text-[11px] opacity-70">
                              ({b.count.toLocaleString()}/{o.totalScenarios.toLocaleString()})
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
