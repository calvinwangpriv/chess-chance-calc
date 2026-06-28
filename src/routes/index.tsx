import { createFileRoute, Link } from "@tanstack/react-router";
import { Card, CardContent } from "@/components/ui/card";
import { Trophy, TrendingUp, ArrowRight } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Chess Tools — Prize & Rating Calculators" },
      {
        name: "description",
        content:
          "A suite of chess tournament tools: prize odds calculator and live USCF rating calculator.",
      },
      { property: "og:title", content: "Chess Tools — Prize & Rating Calculators" },
      {
        property: "og:description",
        content:
          "Calculate prize odds from a SwissSys pairing sheet, or compute your performance and projected USCF rating from standings.",
      },
      { property: "og:url", content: "/" },
    ],
    links: [{ rel: "canonical", href: "/" }],
  }),
  component: Home,
});

const tools = [
  {
    to: "/prize-calculator" as const,
    title: "Prize Odds Calculator",
    desc: "Upload a SwissSys pairing sheet to see your win/draw/lose prize odds.",
    icon: Trophy,
  },
  {
    to: "/rating-calculator" as const,
    title: "Rating Calculator",
    desc: "Upload tournament standings to compute your performance and projected USCF rating using live opponent ratings.",
    icon: TrendingUp,
  },
];

function Home() {
  return (
    <main className="mx-auto max-w-4xl px-4 sm:px-6 py-10 sm:py-16">
      <div className="text-center mb-10">
        <h1
          className="text-3xl sm:text-5xl font-bold tracking-tight bg-clip-text text-transparent"
          style={{ backgroundImage: "var(--gradient-hero)" }}
        >
          Chess Tournament Tools
        </h1>
        <p className="mt-3 text-sm sm:text-base text-muted-foreground">
          Pick a tool to get started.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {tools.map((t) => {
          const Icon = t.icon;
          return (
            <Link key={t.to} to={t.to} className="group">
              <Card className="h-full border-border/60 shadow-[var(--shadow-soft)] hover:shadow-[var(--shadow-elegant)] transition-all hover:scale-[1.02] overflow-hidden">
                <div className="h-1" style={{ background: "var(--gradient-hero)" }} />
                <CardContent className="p-5 sm:p-6">
                  <div className="flex items-center gap-3 mb-3">
                    <div
                      className="grid h-11 w-11 place-items-center rounded-xl text-primary-foreground shadow-[var(--shadow-elegant)]"
                      style={{ background: "var(--gradient-hero)" }}
                    >
                      <Icon className="h-5 w-5" />
                    </div>
                    <h2 className="text-lg sm:text-xl font-semibold">{t.title}</h2>
                  </div>
                  <p className="text-sm text-muted-foreground">{t.desc}</p>
                  <div className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-primary group-hover:gap-2 transition-all">
                    Open <ArrowRight className="h-4 w-4" />
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </main>
  );
}
