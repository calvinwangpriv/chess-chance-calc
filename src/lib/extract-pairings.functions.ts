import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const InputSchema = z.object({
  imageDataUrl: z.string().min(1),
});

export type GameResult = "1-0" | "0-1" | "1/2" | null;
export type PlayerEntry = [string, number, number | null];
export type Pairing = [PlayerEntry, PlayerEntry, GameResult, number | null];


export const extractPairings = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => InputSchema.parse(d))
  .handler(async ({ data }): Promise<{ pairings: Pairing[] }> => {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error("Missing OPENAI_API_KEY");

    const systemPrompt = `You are given an image of a chess tournament pairing sheet (SwissSys format).
Columns: Bd (board number, leftmost column), # (white player number), Res (white result), White (name and "(RATING SCORE)"), # (black number), Res (black result), Black (name and "(RATING SCORE)").

The "Bd" column at the far left is the board number for that pairing (e.g. 55). Capture it as an integer.

In the player cell, the parentheses contain the player's USCF RATING then their SCORE before this round, e.g. "Marcus Chen (1845 4.5)" → rating 1845, score 4.5. If the rating shows "UNR" or is missing, return null for rating.

The "Res" columns show the result of THIS round's game if it has finished:
- "1" or "1.0" means that side won
- "0" or "0.0" means that side lost
- "½" or "0.5" or "1/2" means draw
- blank/empty means the game is still ongoing (no result yet)

Return STRICT JSON only (no markdown, no commentary) of shape:
{"pairings":[{"board":55,"white":{"name":"...","score":0.0,"rating":1800},"black":{"name":"...","score":0.0,"rating":1750},"result":"1-0"|"0-1"|"1/2"|null}, ...]}

"result" rules:
- "1-0" if white's Res is 1 (or black's Res is 0)
- "0-1" if black's Res is 1 (or white's Res is 0)
- "1/2" if either Res cell shows ½/0.5
- null if both Res cells are blank (game ongoing)

Keep player names exactly as shown including titles ("WCM Lilian Wang") and annotations ("Jude Bae* Torrens r/e"), but without the "(RATING SCORE)" part. Skip bye rows. If a board number is unreadable, return null for that pairing's board.`;


    const body = {
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            { type: "text", text: "Extract the pairings from this image as JSON." },
            { type: "image_url", image_url: { url: data.imageDataUrl } },
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

    const json = (await res.json()) as { choices: { message: { content: string } }[] };
    const content = json.choices?.[0]?.message?.content ?? "{}";
    let parsed: any;
    try {
      parsed = JSON.parse(content);
    } catch {
      const match = content.match(/\{[\s\S]*\}/);
      parsed = match ? JSON.parse(match[0]) : { pairings: [] };
    }

    const normResult = (r: any): GameResult => {
      if (r === null || r === undefined || r === "") return null;
      const s = String(r).trim().toLowerCase();
      if (s === "1-0" || s === "1" || s === "1.0") return "1-0";
      if (s === "0-1" || s === "0" || s === "0.0") return "0-1";
      if (s === "1/2" || s === "0.5" || s === "½" || s === "draw" || s === "1/2-1/2") return "1/2";
      return null;
    };

    const normRating = (r: any): number | null => {
      if (r === null || r === undefined || r === "") return null;
      const n = Number(String(r).replace(/[^\d]/g, ""));
      return Number.isFinite(n) && n > 0 ? n : null;
    };

    const normBoard = (b: any): number | null => {
      if (b === null || b === undefined || b === "") return null;
      const n = Number(String(b).replace(/[^\d]/g, ""));
      return Number.isFinite(n) && n > 0 ? n : null;
    };

    const pairings: Pairing[] = (parsed.pairings ?? []).map((p: any) => [
      [String(p.white?.name ?? "").trim(), Number(p.white?.score ?? 0), normRating(p.white?.rating)],
      [String(p.black?.name ?? "").trim(), Number(p.black?.score ?? 0), normRating(p.black?.rating)],
      normResult(p.result),
      normBoard(p.board),
    ]);


    return { pairings };
  });
