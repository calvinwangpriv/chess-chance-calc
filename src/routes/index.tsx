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
import { Loader2, Upload, Trophy, Calculator } from "lucide-react";
import { extractPairings, type Pairing, type GameResult } from "@/lib/extract-pairings.functions";
import { calculatePayouts, type CalcResult } from "@/lib/calculate-payouts";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Chess Prize Odds Calculator" },
      {
        name: "description",
        content:
          "Upload a SwissSys final-round pairing sheet to calculate your win/draw/lose prize odds.",
      },
    ],
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

function Index() {
  const extract = useServerFn(extractPairings);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string>("");
  const [prizes, setPrizes] = useState("");
  const [targetPlayer, setTargetPlayer] = useState("");
  const [pairings, setPairings] = useState<Pairing[]>([]);
  const [result, setResult] = useState<CalcResult | null>(null);
  const [busy, setBusy] = useState(false);

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

  const runCalc = () => {
    if (!pairings.length) return toast.error("Extract pairings first.");
    if (!targetPlayer.trim()) return toast.error("Enter your player name.");
    const prizeArr = prizes
      .split(/[,\n]/)
      .map((s) => Number(s.trim().replace(/[^\d.]/g, "")))
      .filter((n) => !Number.isNaN(n) && n > 0);
    if (!prizeArr.length) return toast.error("Enter at least one prize.");
    try {
      const r = calculatePayouts(pairings, targetPlayer.trim(), prizeArr);
      setResult(r);
    } catch (e: any) {
      toast.error(e?.message ?? "Calculation failed.");
    }
  };

  const updatePairing = (
    i: number,
    field: "wn" | "ws" | "bn" | "bs" | "res",
    value: string,
  ) => {
    setPairings((prev) => {
      const next = prev.map(
        (p) => [[...p[0]] as [string, number], [...p[1]] as [string, number], p[2]] as Pairing,
      );
      const g = next[i];
      if (field === "wn") g[0][0] = value;
      else if (field === "ws") g[0][1] = Number(value);
      else if (field === "bn") g[1][0] = value;
      else if (field === "bs") g[1][1] = Number(value);
      else g[2] = (value === "none" ? null : (value as GameResult));
      return next;
    });
  };

  return (
    <div className="min-h-screen bg-background">
      <Toaster richColors position="top-center" />
      <header className="border-b">
        <div className="mx-auto max-w-5xl px-6 py-8">
          <div className="flex items-center gap-3">
            <Trophy className="h-8 w-8 text-primary" />
            <h1 className="text-3xl font-bold tracking-tight">Chess Prize Odds</h1>
          </div>
          <p className="mt-2 text-muted-foreground">
            Upload a SwissSys final-round pairing sheet, enter the prize list and your name, and
            see your expected winnings if you win, draw, or lose.
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8 space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Upload className="h-5 w-5" /> 1. Upload pairing sheet
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Input
              type="file"
              accept="image/*"
              onChange={(e) => onFile(e.target.files?.[0] ?? null)}
            />
            {imagePreview && (
              <img
                src={imagePreview}
                alt="Pairing preview"
                className="max-h-64 rounded border object-contain"
              />
            )}
            <Button onClick={runExtract} disabled={busy || !imageFile}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Extract pairings with AI
            </Button>
          </CardContent>
        </Card>

        {pairings.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">
                2. Verify extracted pairings ({pairings.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="px-2 py-2 w-8">#</th>
                      <th className="px-2 py-2">White</th>
                      <th className="px-2 py-2 w-20">Score</th>
                      <th className="px-2 py-2">Black</th>
                      <th className="px-2 py-2 w-20">Score</th>
                      <th className="px-2 py-2 w-32">Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pairings.map((p, i) => (
                      <tr key={i} className="border-b">
                        <td className="px-2 py-1 text-muted-foreground">{i + 1}</td>
                        <td className="px-2 py-1">
                          <Input
                            value={p[0][0]}
                            onChange={(e) => updatePairing(i, "wn", e.target.value)}
                          />
                        </td>
                        <td className="px-2 py-1">
                          <Input
                            type="number"
                            step="0.5"
                            value={p[0][1]}
                            onChange={(e) => updatePairing(i, "ws", e.target.value)}
                          />
                        </td>
                        <td className="px-2 py-1">
                          <Input
                            value={p[1][0]}
                            onChange={(e) => updatePairing(i, "bn", e.target.value)}
                          />
                        </td>
                        <td className="px-2 py-1">
                          <Input
                            type="number"
                            step="0.5"
                            value={p[1][1]}
                            onChange={(e) => updatePairing(i, "bs", e.target.value)}
                          />
                        </td>
                        <td className="px-2 py-1">
                          <Select
                            value={p[2] ?? "none"}
                            onValueChange={(v) => updatePairing(i, "res", v)}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">Ongoing</SelectItem>
                              <SelectItem value="1-0">1–0 (White wins)</SelectItem>
                              <SelectItem value="1/2">½–½ (Draw)</SelectItem>
                              <SelectItem value="0-1">0–1 (Black wins)</SelectItem>
                            </SelectContent>
                          </Select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">3. Prize list & your name</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="prizes">Prize list (1st, 2nd, 3rd, …)</Label>
              <Textarea
                id="prizes"
                value={prizes}
                onChange={(e) => setPrizes(e.target.value)}
                placeholder="1800, 900, 500, 300, 200, 150, 100, 75, 50, 25"
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="player">Your name (exactly as it appears in the pairings)</Label>
              <Input
                id="player"
                value={targetPlayer}
                onChange={(e) => setTargetPlayer(e.target.value)}
                placeholder="Calvin Jiarui Wang"
                className="mt-1"
                list="players"
              />
              <datalist id="players">
                {pairings.flatMap((p, i) => [
                  <option key={`w${i}`} value={p[0][0]} />,
                  <option key={`b${i}`} value={p[1][0]} />,
                ])}
              </datalist>
            </div>
            <Button onClick={runCalc} disabled={!pairings.length}>
              <Calculator className="mr-2 h-4 w-4" />
              Calculate odds
            </Button>
          </CardContent>
        </Card>

        {result && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Results</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <p className="text-sm text-muted-foreground">
                {result.totalBoards} total boards · {result.criticalBoards} simulated ·{" "}
                {result.trivialBoards} bypassed · your start score: {result.targetStartScore}
              </p>
              {result.outcomes.map((o) => (
                <div key={o.outcome} className="space-y-2">
                  <h3 className="font-semibold">
                    If I {o.outcome.toLowerCase()}:
                  </h3>
                  {o.totalScenarios === 0 ? (
                    <p className="text-sm text-muted-foreground">No scenarios.</p>
                  ) : o.exactPayout !== undefined ? (
                    <p className="text-sm">
                      100% chance of exactly{" "}
                      <span className="font-semibold">${o.exactPayout}</span>
                    </p>
                  ) : (
                    <div className="space-y-1">
                      {[...o.bins].reverse().map((b, idx) => (
                        <div
                          key={idx}
                          className="flex items-center gap-3 text-sm"
                        >
                          <div className="w-16 text-right tabular-nums font-medium">
                            {b.percent.toFixed(1)}%
                          </div>
                          <div className="flex-1 h-2 bg-muted rounded overflow-hidden">
                            <div
                              className="h-full bg-primary"
                              style={{ width: `${b.percent}%` }}
                            />
                          </div>
                          <div className="w-32 text-muted-foreground tabular-nums">
                            ${b.start} – ${b.end}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
