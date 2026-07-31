import { useEffect, useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";

export type PlayerOption = {
  name: string;
  hint?: string;
};

function norm(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

function score(option: string, query: string) {
  const o = norm(option);
  const q = norm(query);
  if (!q) return 0;
  if (o === q) return 0;
  if (o.startsWith(q)) return 1;
  // token match: every query token appears somewhere (handles "First Last" vs "LAST, FIRST")
  const tokens = q.split(" ");
  if (tokens.every((t) => o.includes(t))) return 2;
  if (o.includes(q)) return 3;
  return -1;
}

type Props = {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  options: PlayerOption[];
  placeholder?: string;
  className?: string;
};

export function PlayerSearch({ id, value, onChange, options, placeholder, className }: Props) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);

  const matches = useMemo(() => {
    const q = value.trim();
    const scored = options
      .map((o) => ({ o, s: q ? score(o.name, q) : 0 }))
      .filter((x) => x.s >= 0);
    scored.sort((a, b) => a.s - b.s || a.o.name.localeCompare(b.o.name));
    return scored.slice(0, 8).map((x) => x.o);
  }, [options, value]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const pick = (name: string) => {
    onChange(name);
    setOpen(false);
  };

  const showList = open && matches.length > 0;

  return (
    <div ref={wrapRef} className={`relative ${className ?? ""}`}>
      <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        id={id}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (!showList) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => (a + 1) % matches.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => (a - 1 + matches.length) % matches.length);
          } else if (e.key === "Enter") {
            e.preventDefault();
            pick(matches[active]!.name);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        placeholder={placeholder}
        className="h-8 pl-7 pr-2 text-xs sm:h-9 sm:text-sm"
        autoComplete="off"
        role="combobox"
        aria-expanded={showList}
        aria-autocomplete="list"
      />
      {showList && (
        <ul
          role="listbox"
          className="absolute z-50 mt-1 max-h-56 w-full overflow-auto rounded-md border border-border/60 bg-popover p-1 shadow-[var(--shadow-elegant)]"
        >
          {matches.map((m, i) => (
            <li key={`${m.name}-${i}`}>
              <button
                type="button"
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(m.name)}
                className={`flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-xs sm:text-sm ${
                  i === active ? "bg-primary/10 text-foreground" : "text-foreground/90"
                }`}
              >
                <span className="truncate">{m.name}</span>
                {m.hint && <span className="shrink-0 text-[11px] text-muted-foreground">{m.hint}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
