import { ChevronRight, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { supabase, run } from "../supabase";
import { Live, LiveTr, SkeletonRows } from "../motion";
import { Badge, Empty, ErrorNote, PageHeader, card, input, th } from "../ui";
import { OPEN, SITES, STAGES, ago } from "../crm";

export default function Leads() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [list, setList] = useState(null);
  const [error, setError] = useState("");
  const [text, setText] = useState("");
  const stage = params.get("stage") ?? "open";
  const site = params.get("site") ?? "";

  useEffect(() => {
    run(supabase.from("leads").select("id, name, email, mobile, interest, source_site, stage, created_at, agent:admin_users(name), listing:listings(title)").order("created_at", { ascending: false })).then(
      setList,
      (e) => setError(e.message)
    );
  }, []);

  // ponytail: every lead loaded and filtered in the browser; move the search to SQL past a few thousand
  const shown = useMemo(() => {
    const q = text.trim().toLowerCase();
    return (list ?? []).filter(
      (l) =>
        (stage === "all" || (stage === "open" ? OPEN.includes(l.stage) : l.stage === stage)) &&
        (!site || l.source_site === site) &&
        (!q || [l.name, l.email, l.mobile, l.interest, l.listing?.title].some((v) => v?.toLowerCase().includes(q)))
    );
  }, [list, text, stage, site]);
  const set = (k) => (e) => setParams((p) => (e.target.value ? p.set(k, e.target.value) : p.delete(k), p), { replace: true });

  return (
    <>
      <PageHeader title="Leads" sub="Every inquiry and viewing request from the six sites. Each one is emailed to its agent the moment it arrives." />

      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <label className="relative sm:max-w-xs sm:flex-1">
          <span className="sr-only">Search leads</span>
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <input type="search" placeholder="Search name, email, mobile…" value={text} onChange={(e) => setText(e.target.value)} className={`${input} pl-9`} />
        </label>
        <select aria-label="Filter by stage" value={stage} onChange={set("stage")} className={`${input} sm:w-44`}>
          <option value="open">Open deals</option>
          <option value="all">Every stage</option>
          {Object.entries(STAGES).map(([k, s]) => <option key={k} value={k}>{s}</option>)}
        </select>
        <select aria-label="Filter by site" value={site} onChange={set("site")} className={`${input} sm:w-48`}>
          <option value="">Every site</option>
          {Object.entries(SITES).map(([k, s]) => <option key={k} value={k}>{s}</option>)}
        </select>
      </div>

      <div className="mt-4">
        <ErrorNote error={error} />
      </div>

      <div className={`${card} mt-4 overflow-x-auto`}>
        {!list ? (
          <SkeletonRows />
        ) : !shown.length ? (
          <Empty>{list.length ? "No leads match." : "No inquiries yet. They'll appear here as they arrive."}</Empty>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-line">
              <tr>
                <th className={th}>Lead</th>
                <th className={`${th} hidden md:table-cell`}>From</th>
                <th className={`${th} hidden lg:table-cell`}>Agent</th>
                <th className={`${th} hidden sm:table-cell`}>Received</th>
                <th className={th}>Stage</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              <Live>
                {shown.map((l, i) => (
                  <LiveTr key={l.id} i={i} onClick={(e) => !e.target.closest("a") && navigate(`/leads/${l.id}`)} className="group cursor-pointer transition-colors hover:bg-bg active:bg-sunken">
                    <td className="w-full max-w-0 px-4 py-3">
                      <Link to={`/leads/${l.id}`} className="block truncate font-medium text-fg outline-offset-4 group-hover:text-accent-ink">
                        {l.name}
                      </Link>
                      <p className="truncate text-xs text-muted">{[l.interest, l.listing?.title].filter(Boolean).join(" · ")}</p>
                    </td>
                    <td className="hidden px-4 py-3 whitespace-nowrap text-muted md:table-cell">{SITES[l.source_site] ?? l.source_site}</td>
                    <td className="hidden px-4 py-3 whitespace-nowrap text-muted lg:table-cell">{l.agent?.name ?? "—"}</td>
                    <td className="hidden px-4 py-3 whitespace-nowrap text-muted sm:table-cell">{ago(l.created_at)}</td>
                    <td className="px-4 py-3">
                      <span className="flex items-center justify-between gap-2">
                        <Badge value={l.stage}>{STAGES[l.stage]}</Badge>
                        <ChevronRight className="size-4 text-muted/50 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-muted" aria-hidden />
                      </span>
                    </td>
                  </LiveTr>
                ))}
              </Live>
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
