import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const OutcomeStatSchema = z.object({
  outcome: z.enum(["Win", "Draw", "Lose"]),
  totalScenarios: z.number(),
  avgPayout: z.number(),
  minPayout: z.number(),
  maxPayout: z.number(),
});

const SummaryDataSchema = z.object({
  targetPlayer: z.string(),
  bestPayout: z.number(),
  bestSource: z.string(),
  bestClassPrizeLabel: z.string().nullable(),
  targetWish: z.string().nullable(),
  otherBoardNeeds: z.array(z.string()),
  classCompetitionNeeds: z.array(z.string()),
  outcomeStats: z.array(OutcomeStatSchema),
  totalScenarios: z.number(),
  criticalBoards: z.number(),
  trivialBoards: z.number(),
});

const InputSchema = z.object({ data: SummaryDataSchema });

export const summarizeResult = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => InputSchema.parse(d))
  .handler(async ({ data }): Promise<{ summary: string }> => {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error("Missing OPENAI_API_KEY");

    const systemPrompt = `You are a chess tournament prize analyst. You'll receive a JSON object describing a player's best-case payout scenario in the final round of a Swiss chess tournament with overall and optional class (rating-section) prizes.

Write a 2–5 sentence recap in second person ("you") telling the player what to root for to hit their best-case payout. Be natural and concrete — mention dollar amounts, specific opponent names, and whether the top payout comes from the overall pool or a class prize. Always include:
1. The best-case payout amount and what you need from your own game (targetWish: if null, say it doesn't depend on your result).
2. If bestClassPrizeLabel is set, mention that the top payout comes from that class prize.
3. Key results needed from other boards (use otherBoardNeeds verbatim — these are exact phrasings like "Alice beats Bob"). If there are many, summarize.
4. If classCompetitionNeeds is non-empty, mention you also want those competitors eliminated for the class prize.
5. Optionally, a brief note on what the outcomeStats imply (e.g. "even a draw still averages $X").

STRICT RULES:
- Use ONLY names, numbers, and phrases from the input JSON. Do NOT invent player names, scores, ratings, or amounts.
- Format money as $1,234 (with commas, no decimals).
- Return STRICT JSON only: {"summary": "..."}
- No markdown, no bullet lists, just flowing prose.`;

    const body = {
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: JSON.stringify(data.data) },
      ],
      response_format: { type: "json_object" },
      temperature: 0.7,
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
      if (res.status === 429) throw new Error("Rate limited.");
      if (res.status === 401) throw new Error("Invalid OpenAI API key.");
      throw new Error(`AI summary failed (${res.status}): ${txt}`);
    }

    const json = (await res.json()) as { choices: { message: { content: string } }[] };
    const content = json.choices?.[0]?.message?.content ?? "{}";
    let parsed: { summary?: string };
    try {
      parsed = JSON.parse(content);
    } catch {
      const m = content.match(/\{[\s\S]*\}/);
      parsed = m ? JSON.parse(m[0]) : {};
    }
    const summary = String(parsed.summary ?? "").trim();
    if (!summary) throw new Error("Empty summary from AI.");
    return { summary };
  });
