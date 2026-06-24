import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const InputSchema = z.object({
  imageDataUrl: z.string().min(1),
});

export type Pairing = [[string, number], [string, number]];

export const extractPairings = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => InputSchema.parse(d))
  .handler(async ({ data }): Promise<{ pairings: Pairing[] }> => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");

    const systemPrompt = `You are given an image of a chess tournament pairing sheet (SwissSys format).
Each row has: Board number, White player number, (Result), White player name with rating and score, Black player number, (Result), Black player name with rating and score.
Player entries look like "Name (RATING SCORE)" e.g. "Daniel Yassky (2080 5.0)". The score is the last number in parens.
Extract ALL rows and return STRICT JSON only (no markdown, no commentary) of shape:
{"pairings":[{"white":{"name":"...","score":0.0},"black":{"name":"...","score":0.0}}, ...]}
Score must be a number (e.g. 4.5, 5.0, 3.0). Use the player's full displayed name (omit titles like WCM if present? KEEP titles like "WCM Lilian Wang" exactly as shown). Preserve asterisks and annotations like "Jude Bae* Torrens r/e" exactly as shown but WITHOUT the rating/score. If a row has a bye or missing opponent, skip it.`;

    const body = {
      model: "google/gemini-3-flash-preview",
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

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
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
      if (res.status === 402) throw new Error("AI credits exhausted. Add credits in your workspace.");
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

    const pairings: Pairing[] = (parsed.pairings ?? []).map((p: any) => [
      [String(p.white?.name ?? "").trim(), Number(p.white?.score ?? 0)],
      [String(p.black?.name ?? "").trim(), Number(p.black?.score ?? 0)],
    ]);

    return { pairings };
  });
