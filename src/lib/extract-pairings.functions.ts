import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const InputSchema = z.object({
  imageDataUrl: z.string().min(1),
});

export type GameResult = "1-0" | "0-1" | "1/2" | null;
export type Pairing = [[string, number], [string, number], GameResult];

export const extractPairings = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => InputSchema.parse(d))
  .handler(async ({ data }): Promise<{ pairings: Pairing[] }> => {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error("Missing OPENAI_API_KEY");

    const systemPrompt = `You are given an image of a chess tournament pairing sheet (SwissSys format).
Columns: Bd (board), # (white player number), Res (white result), White (name and "(RATING SCORE)"), # (black number), Res (black result), Black (name and "(RATING SCORE)").

The "Res" columns show the result of THIS round's game if it has finished:
- "1" or "1.0" means that side won
- "0" or "0.0" means that side lost
- "½" or "0.5" or "1/2" means draw
- blank/empty means the game is still ongoing (no result yet)

The score in the player's "(RATING SCORE)" is the player's score BEFORE this round.

Return STRICT JSON only (no markdown, no commentary) of shape:
{"pairings":[{"white":{"name":"...","score":0.0},"black":{"name":"...","score":0.0},"result":"1-0"|"0-1"|"1/2"|null}, ...]}

"result" rules:
- "1-0" if white's Res is 1 (or black's Res is 0)
- "0-1" if black's Res is 1 (or white's Res is 0)
- "1/2" if either Res cell shows ½/0.5
- null if both Res cells are blank (game ongoing)

Keep player names exactly as shown including titles ("WCM Lilian Wang") and annotations ("Jude Bae* Torrens r/e"), but without the "(RATING SCORE)" part. Skip bye rows.`;

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

    const pairings: Pairing[] = (parsed.pairings ?? []).map((p: any) => [
      [String(p.white?.name ?? "").trim(), Number(p.white?.score ?? 0)],
      [String(p.black?.name ?? "").trim(), Number(p.black?.score ?? 0)],
      normResult(p.result),
    ]);

    return { pairings };
  });
