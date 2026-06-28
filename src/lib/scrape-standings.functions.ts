import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { StandingsPlayer, StandingsGame, StandingsResult } from "./extract-standings.functions";

const InputSchema = z.object({
  url: z.string().url(),
});

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ")
    .trim();
}

function parseTable(html: string): { headers: string[]; rows: string[][] } | null {
  const tableMatch = html.match(/<table[\s\S]*?<\/table>/i);
  if (!tableMatch) return null;
  const table = tableMatch[0];

  const headers: string[] = [];
  const thRe = /<th\b[^>]*>([\s\S]*?)<\/th>/gi;
  let m: RegExpExecArray | null;
  while ((m = thRe.exec(table)) !== null) headers.push(stripTags(m[1]));

  const rows: string[][] = [];
  const trRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let tr: RegExpExecArray | null;
  while ((tr = trRe.exec(table)) !== null) {
    const tdRe = /<td\b[^>]*>([\s\S]*?)<\/td>/gi;
    const cells: string[] = [];
    let td: RegExpExecArray | null;
    while ((td = tdRe.exec(tr[1])) !== null) cells.push(stripTags(td[1]));
    if (cells.length) rows.push(cells);
  }
  return { headers, rows };
}

const RESULT_LETTER: Record<string, StandingsResult> = {
  W: "W", L: "L", D: "D", B: "B", H: "H", F: "F", U: "U",
};

function parseRoundCell(cell: string): StandingsGame | null {
  if (!cell) return null;
  // e.g. "W40 (b)", "L2 (w)", "H---", "B---", "U---", "X40"
  const m = cell.match(/^([WLDBHFUX])\s*(\d+)?(?:\s*\(([wbWB])\))?/);
  if (!m) return null;
  let letter = m[1].toUpperCase();
  if (letter === "X") letter = "W"; // forfeit win counts as win for rating? Skip — treat as no rated opp
  const res = RESULT_LETTER[letter] ?? "U";
  const opp = m[2] ? Number(m[2]) : null;
  const colorLetter = m[3]?.toUpperCase();
  const color = colorLetter === "W" || colorLetter === "B" ? (colorLetter as "W" | "B") : null;
  return { round: 0, opponentPairing: opp, result: res, color };
}

function findHeaderIndex(headers: string[], patterns: RegExp[]): number {
  for (let i = 0; i < headers.length; i++) {
    for (const p of patterns) if (p.test(headers[i])) return i;
  }
  return -1;
}

function extractChessRosterId(url: string): string | null {
  const apiMatch = url.match(/chessroster\.com\/api\/tournaments\/([^/?#]+)/i);
  if (apiMatch) return apiMatch[1];
  const pageMatch = url.match(/chessroster\.com\/(?:t|tournaments)\/([^/?#]+)/i);
  if (pageMatch) return pageMatch[1];
  return null;
}

type CRPlayer = {
  id1?: string;
  name: string;
  rating?: number;
  score?: number;
  pair_number: number;
  ops?: number[];
  results?: string[];
  colors?: string[];
};
type CRSection = {
  section?: string;
  players?: CRPlayer[];
  rounds_paired?: number;
  rounds_played?: number;
};

async function fetchChessRoster(
  id: string,
): Promise<{ players: StandingsPlayer[]; totalRounds: number }> {
  const apiUrl = `https://www.chessroster.com/api/tournaments/${encodeURIComponent(id)}/reports`;
  const res = await fetch(apiUrl, {
    headers: { "User-Agent": "Mozilla/5.0 ChessToolsBot", Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Failed to fetch ChessRoster (HTTP ${res.status})`);
  const json = (await res.json()) as { swisssysReport?: { sections?: CRSection[] } };
  const sections = json.swisssysReport?.sections ?? [];
  if (!sections.length) throw new Error("ChessRoster response has no sections.");

  const normResult = (r: string): StandingsResult => {
    const s = (r || "").toUpperCase();
    if (s === "W" || s === "L" || s === "D" || s === "B" || s === "H" || s === "F" || s === "U") {
      return s as StandingsResult;
    }
    if (s === "X") return "W";
    return "U";
  };
  const normColor = (c: string): "W" | "B" | null => {
    const s = (c || "").toUpperCase();
    return s === "W" || s === "B" ? s : null;
  };

  const out: StandingsPlayer[] = [];
  let totalRounds = 0;
  let offset = 0;
  for (const sec of sections) {
    const secPlayers = sec.players ?? [];
    const secRounds = sec.rounds_paired ?? sec.rounds_played ?? 0;
    if (secRounds > totalRounds) totalRounds = secRounds;
    for (const p of secPlayers) {
      const ops = p.ops ?? [];
      const results = p.results ?? [];
      const colors = p.colors ?? [];
      const games: StandingsGame[] = [];
      const rounds = Math.max(ops.length, results.length);
      for (let i = 0; i < rounds; i++) {
        const rLetter = (results[i] ?? "").toUpperCase();
        if (!rLetter || rLetter === "U") continue;
        const oppPair = ops[i];
        const noOpp =
          !oppPair ||
          oppPair === 0 ||
          rLetter === "B" ||
          rLetter === "H" ||
          rLetter === "X" ||
          rLetter === "F";
        games.push({
          round: i + 1,
          opponentPairing: noOpp ? null : offset + oppPair,
          result: normResult(rLetter),
          color: normColor(colors[i] ?? ""),
        });
      }
      const idRaw = String(p.id1 ?? "").replace(/\D/g, "");
      out.push({
        pairingNumber: offset + p.pair_number,
        name: p.name,
        uscfId: idRaw.length >= 6 ? idRaw : null,
        rating: p.rating && p.rating > 0 ? p.rating : null,
        score: Number(p.score ?? 0) || 0,
        games,
        sectionRounds: secRounds,
      });

    }
    offset += secPlayers.length;
  }
  return { players: out, totalRounds };
}

export const scrapeStandings = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => InputSchema.parse(d))
  .handler(async ({ data }): Promise<{ players: StandingsPlayer[]; totalRounds: number }> => {
    const crId = extractChessRosterId(data.url);
    if (crId) return fetchChessRoster(crId);

    const res = await fetch(data.url, {
      headers: { "User-Agent": "Mozilla/5.0 ChessToolsBot" },
    });
    if (!res.ok) throw new Error(`Failed to fetch page (HTTP ${res.status})`);

    const html = await res.text();
    const parsed = parseTable(html);
    if (!parsed) throw new Error("No table found on that page.");
    const { headers, rows } = parsed;
    if (!headers.length || !rows.length) throw new Error("Standings table looks empty.");

    const idxPair = findHeaderIndex(headers, [/^#$/i, /^pair/i, /^bd$/i]);
    const idxName = findHeaderIndex(headers, [/^name$/i, /player/i]);
    const idxId = findHeaderIndex(headers, [/^id$/i, /uscf/i, /member/i]);
    const idxRating = findHeaderIndex(headers, [/^rating$/i, /^rtg/i]);
    const idxTotal = findHeaderIndex(headers, [/^total$/i, /^score$/i, /^pts$/i]);

    const roundIdxs: { round: number; idx: number }[] = [];
    headers.forEach((h, i) => {
      const m = h.match(/^(?:rd|round|r)\s*\.?\s*(\d+)$/i);
      if (m) roundIdxs.push({ round: Number(m[1]), idx: i });
    });

    if (idxName === -1) throw new Error("Couldn't find a Name column in the standings table.");

    const players: StandingsPlayer[] = [];
    for (const cells of rows) {
      const name = (cells[idxName] ?? "").trim();
      if (!name) continue;
      const pair = idxPair >= 0 ? Number(String(cells[idxPair]).replace(/\D/g, "")) || null : null;
      const idRaw = idxId >= 0 ? String(cells[idxId] ?? "").replace(/\D/g, "") : "";
      const uscfId = idRaw.length >= 6 ? idRaw : null;
      const rating = idxRating >= 0 ? Number(String(cells[idxRating]).replace(/\D/g, "")) || null : null;
      const score = idxTotal >= 0 ? Number(cells[idxTotal]) || 0 : 0;
      const games: StandingsGame[] = [];
      for (const { round, idx } of roundIdxs) {
        const g = parseRoundCell(cells[idx] ?? "");
        if (g) games.push({ ...g, round });
      }
      players.push({ pairingNumber: pair, name, uscfId, rating, score, games });
    }

    const totalRounds = roundIdxs.reduce((m, r) => Math.max(m, r.round), 0);
    return { players, totalRounds };
  });
