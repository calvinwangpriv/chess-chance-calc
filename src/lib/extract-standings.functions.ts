import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const InputSchema = z.object({
  imageDataUrls: z.array(z.string().min(1)).min(1).max(20),
});

export type StandingsResult = "W" | "L" | "D" | "B" | "F" | "U" | "H";
export type StandingsGame = {
  round: number;
  /** Opponent's pairing number (the leftmost "#" column). Null for bye/forfeit. */
  opponentPairing: number | null;
  result: StandingsResult;
  /** "W" for white, "B" for black; null if unknown */
  color: "W" | "B" | null;
};

export type StandingsPlayer = {
  pairingNumber: number | null;
  name: string;
  uscfId: string | null;
  rating: number | null;
  score: number;
  games: StandingsGame[];
};

export const extractStandings = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => InputSchema.parse(d))
  .handler(async ({ data }): Promise<{ players: StandingsPlayer[] }> => {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error("Missing OPENAI_API_KEY");

    const systemPrompt = `You are reading USCF chess tournament standings sheets (typically SwissSys format).
The sheet lists every player in the section with columns roughly like:
  Pair# | Name | USCF ID | Rating | Rd1 | Rd2 | Rd3 ... | Total

Round cells look like "W12", "L7", "D3", "H---", "B---", "U---" where the letter is the result (W=win, L=loss, D=draw, H=half-point bye, B=full-point bye, U=unplayed, F=forfeit) and the number is the OPPONENT'S pairing number (the leftmost column for that opponent). Sometimes the cell also includes color, e.g. "W12W" (won as white) or "L7B" (lost as black).

You may be given MULTIPLE images that are pages of the SAME standings sheet — merge them into one player list. Deduplicate by USCF ID or pairing number.

Return STRICT JSON only:
{
  "players": [
    {
      "pairingNumber": 1,
      "name": "Magnus Carlsen",
      "uscfId": "12345678",
      "rating": 2850,
      "score": 4.5,
      "games": [
        { "round": 1, "opponentPairing": 24, "result": "W", "color": "W" },
        { "round": 2, "opponentPairing": 12, "result": "D", "color": "B" }
      ]
    }
  ]
}

Rules:
- uscfId is the 8-digit USCF member ID. If missing/unreadable, return null.
- rating is the pre-tournament regular rating as shown (integer). If missing, null.
- score is the player's current total points (number, may be .5).
- For each round cell that has a result, emit a game entry. Omit unplayed rounds.
- result must be one of: "W", "L", "D", "B" (full-point bye), "H" (half-point bye), "F" (forfeit), "U" (unplayed).
- For byes/forfeits with no opponent, set opponentPairing to null.
- color: "W" if the player had white, "B" if black, null if unknown.
- Use exact names as printed.`;

    const body = {
      model: "gpt-4o",
      max_tokens: 16000,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            { type: "text", text: "Extract every player and their round-by-round results from these standings page(s)." },
            ...data.imageDataUrls.map((url) => ({
              type: "image_url" as const,
              image_url: { url },
            })),
          ],
        },
      ],
      response_format: { type: "json_object" },
    };

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      if (res.status === 429) throw new Error("Rate limited. Please try again shortly.");
      if (res.status === 401) throw new Error("Invalid OpenAI API key.");
      throw new Error(`AI extraction failed (${res.status}): ${txt}`);
    }

    const json = (await res.json()) as { choices: { message: { content: string }; finish_reason?: string }[] };
    const content = json.choices?.[0]?.message?.content ?? "{}";

    const repairTruncatedPlayers = (s: string): string | null => {
      const pIdx = s.indexOf('"players"');
      if (pIdx === -1) return null;
      const arrStart = s.indexOf("[", pIdx);
      if (arrStart === -1) return null;
      let depth = 0, inStr = false, esc = false, lastObjEnd = -1;
      for (let i = arrStart; i < s.length; i++) {
        const ch = s[i];
        if (inStr) {
          if (esc) esc = false;
          else if (ch === "\\") esc = true;
          else if (ch === '"') inStr = false;
          continue;
        }
        if (ch === '"') inStr = true;
        else if (ch === "{" || ch === "[") depth++;
        else if (ch === "}" || ch === "]") {
          depth--;
          if (depth === 1 && ch === "}") lastObjEnd = i;
        }
      }
      if (lastObjEnd === -1) return s.slice(0, arrStart + 1) + "]}";
      return s.slice(0, lastObjEnd + 1) + "]}";
    };

    let parsed: any;
    try {
      parsed = JSON.parse(content);
    } catch {
      const repaired = repairTruncatedPlayers(content);
      try {
        parsed = repaired ? JSON.parse(repaired) : { players: [] };
      } catch {
        parsed = { players: [] };
      }
    }


    const toInt = (v: any): number | null => {
      if (v === null || v === undefined || v === "") return null;
      const n = Number(String(v).replace(/[^\d]/g, ""));
      return Number.isFinite(n) && n > 0 ? n : null;
    };
    const toIdStr = (v: any): string | null => {
      if (v === null || v === undefined) return null;
      const s = String(v).replace(/[^\d]/g, "");
      return s.length >= 6 ? s : null;
    };
    const normResult = (r: any): StandingsResult => {
      const s = String(r ?? "").trim().toUpperCase();
      if (s === "W" || s === "L" || s === "D" || s === "B" || s === "H" || s === "F" || s === "U") return s;
      return "U";
    };
    const normColor = (c: any): "W" | "B" | null => {
      const s = String(c ?? "").trim().toUpperCase();
      return s === "W" || s === "B" ? s : null;
    };

    const players: StandingsPlayer[] = (parsed.players ?? []).map((p: any) => ({
      pairingNumber: toInt(p.pairingNumber),
      name: String(p.name ?? "").trim(),
      uscfId: toIdStr(p.uscfId),
      rating: toInt(p.rating),
      score: Number(p.score ?? 0) || 0,
      games: (p.games ?? []).map((g: any) => ({
        round: Number(g.round) || 0,
        opponentPairing: toInt(g.opponentPairing),
        result: normResult(g.result),
        color: normColor(g.color),
      })),
    }));

    return { players };
  });
