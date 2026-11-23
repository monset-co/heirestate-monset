// How much of her monthly allowance Mons has used: Gemini tokens since the 1st (Manila) against the
// mons_monthly_tokens setting. It moves live: each reply she posts arrives through realtime with
// what it cost. At the cap the Worker stops her (admin/worker/mons.js).
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { supabase, run } from "./supabase";

const DEFAULT_CAP = 5_000_000; // the Worker's own default, admin/worker/mons.js
const short = new Intl.NumberFormat("en-PH", { notation: "compact", maximumFractionDigits: 1 });

export default function MonsUsage({ className = "" }) {
  const [used, setUsed] = useState(null);
  const [cap, setCap] = useState(DEFAULT_CAP);

  useEffect(() => {
    run(supabase.rpc("mons_tokens_this_month")).then((n) => setUsed(Number(n)), () => {});
    run(supabase.from("settings").select("value").eq("key", "mons_monthly_tokens")).then((r) => Number(r[0]?.value) > 0 && setCap(Number(r[0].value)), () => {});
    const ch = supabase
      .channel(`mons-usage-${crypto.randomUUID()}`) // its own name: see Bell.jsx
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "mons_messages" }, ({ new: n }) => n.tokens && setUsed((u) => (u ?? 0) + n.tokens))
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, []);

  if (used === null) return null;
  const pct = Math.min(100, (used / cap) * 100);
  const tone = pct >= 90 ? "bg-danger" : pct >= 70 ? "bg-gold" : "bg-navy";
  return (
    <Link to="/mons" className={`group block text-xs ${className}`} title={`${used.toLocaleString("en-PH")} of ${cap.toLocaleString("en-PH")} tokens`}>
      <span className="flex items-baseline justify-between gap-3">
        <span className="text-muted group-hover:text-fg">Mons this month</span>
        <span className={`tabular-nums ${pct >= 90 ? "font-medium text-danger" : "text-muted"}`}>
          {short.format(used)} of {short.format(cap)} tokens · {Math.floor(pct)}%
        </span>
      </span>
      <span
        className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-sunken"
        role="progressbar"
        aria-label="Mons's monthly allowance used"
        aria-valuenow={Math.floor(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <span className={`block h-full rounded-full transition-[width] duration-500 ease-[var(--ease-out)] ${tone}`} style={{ width: `${pct}%` }} />
      </span>
    </Link>
  );
}
