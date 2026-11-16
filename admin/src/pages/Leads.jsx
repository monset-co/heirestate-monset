import { ChevronRight, Search } from "lucide-react";
import { useMe } from "../me";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { supabase, run } from "../supabase";
import { Live, LiveTr, SkeletonRows } from "../motion";
import { Badge, Empty, ErrorNote, PageHeader, card, input, th } from "../ui";
import { ON_THE_CLOCK, OPEN, SITES, STAGES, TEMPS, ago, papersDue, quiet } from "../crm";

// Quick lists, the saved views a CRM keeps: each one a question an agent asks every morning.
const LISTS = {
  open: ["Open deals", (l) => OPEN.includes(l.stage)],
  mine: ["Mine", (l, me) => OPEN.includes(l.stage) && l.agent_id === me.id],
  uncalled: ["Not yet called", (l) => l.stage === "new"],
  quiet: ["Gone quiet", (l) => OPEN.includes(l.stage) && quiet(l.last_contact_at)],
  papers: ["Papers due", (l) => l.stage === "reserved" && l.papers_verified < ON_THE_CLOCK.length],
  hot: ["Hot", (l) => OPEN.includes(l.stage) && l.temperature === "hot"],
  all: ["Everyone", () => true],
};

export default function Leads() {
  const navigate = useNavigate();
  const me = useMe();
  const [params, setParams] = useSearchParams();
  const [list, setList] = useState(null);
  const [error, setError] = useState("");
  const [text, setText] = useState("");
  const stage = params.get("stage") ?? "";
  const listKey = LISTS[params.get("list")] ? params.get("list") : "open";
  const site = params.get("site") ?? "";

  useEffect(() => {
    Promise.all([
      run(supabase.from("leads").select("id, name, email, mobile, interest, source_site, stage, temperature, reserved_at, agent_id, created_at, agent:admin_users(name), listing:listings(title)").order("created_at", { ascending: false })),
      run(supabase.from("lead_overview").select("*")),
    ]).then(([leads, overview]) => {
      const o = new Map(overview.map((r) => [r.id, r]));
      setList(leads.map((l) => ({ ...l, ...o.get(l.id) })));
    }, (e) => setError(e.message));
  }, []);

  // ponytail: every lead loaded and filtered in the browser; move the search to SQL past a few thousand
  const shown = useMemo(() => {
    const q = text.trim().toLowerCase();
    return (list ?? []).filter(
      (l) =>
        LISTS[listKey][1](l, me) &&
        (!stage || l.stage === stage) &&
        (!site || l.source_site === site) &&
        (!q || [l.name, l.email, l.mobile, l.interest, l.listing?.title].some((v) => v?.toLowerCase().includes(q)))
    );
  }, [list, text, stage, site, listKey, me]);
  const set = (k) => (e) => setParams((p) => (e.target.value ? p.set(k, e.target.value) : p.delete(k), p), { replace: true });

  return (
    <>
      <PageHeader title="Leads" sub="Every inquiry and viewing request from the six sites. Each one is emailed to its agent the moment it arrives." />

      <div role="group" aria-label="Quick lists" className="mt-6 flex gap-2 overflow-x-auto pb-1">
        {Object.entries(LISTS).map(([k, [label, test]]) => {
          const n = list?.filter((l) => test(l, me)).length;
          return (
            <button
              key={k}
              type="button"
              aria-pressed={listKey === k}
              onClick={() => setParams((p) => (k === "open" ? p.delete("list") : p.set("list", k), p), { replace: true })}
              className={`press inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors duration-150 ${listKey === k ? "border-navy bg-navy text-cream" : "border-line bg-surface text-fg hover:border-muted/50"}`}
            >
              {label}
              {n > 0 && k !== "all" && <span className={`text-xs tabular-nums ${listKey === k ? "text-cream/70" : "text-muted"}`}>{n}</span>}
            </button>
          );
        })}
      </div>

      <div className="mt-3 flex flex-col gap-3 sm:flex-row">
        <label className="relative sm:max-w-xs sm:flex-1">
          <span className="sr-only">Search leads</span>
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <input type="search" placeholder="Search name, email, mobile…" value={text} onChange={(e) => setText(e.target.value)} className={`${input} pl-9`} />
        </label>
        <select aria-label="Filter by stage" value={stage} onChange={set("stage")} className={`${input} sm:w-44`}>
          <option value="">Any stage</option>
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
          <Empty>{list.length ? (listKey === "quiet" ? "Nobody has gone quiet. Every open lead has been in touch this week." : listKey === "papers" ? "No reserved buyer is missing papers." : "No leads match.") : "No inquiries yet. They'll appear here as they arrive."}</Empty>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-line">
              <tr>
                <th className={th}>Lead</th>
                <th className={`${th} hidden md:table-cell`}>From</th>
                <th className={`${th} hidden lg:table-cell`}>Agent</th>
                <th className={`${th} hidden sm:table-cell`}>Last contact</th>
                <th className={`${th} hidden xl:table-cell`}>Next step</th>
                <th className={th}>Stage</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              <Live>
                {shown.map((l, i) => (
                  <LiveTr key={l.id} i={i} onClick={(e) => !e.target.closest("a") && navigate(`/leads/${l.id}`)} className="group cursor-pointer transition-colors hover:bg-bg active:bg-sunken">
                    <td className="w-full max-w-0 px-4 py-3">
                      <span className="flex items-center gap-2">
                        <Link to={`/leads/${l.id}`} className="truncate font-medium text-fg outline-offset-4 group-hover:text-accent-ink">
                          {l.name}
                        </Link>
                        {l.temperature && <Badge value={l.temperature}>{TEMPS[l.temperature]}</Badge>}
                      </span>
                      <p className="truncate text-xs text-muted">{[l.interest, l.listing?.title].filter(Boolean).join(" · ")}</p>
                    </td>
                    <td className="hidden px-4 py-3 whitespace-nowrap text-muted md:table-cell">{SITES[l.source_site] ?? l.source_site}</td>
                    <td className="hidden px-4 py-3 whitespace-nowrap text-muted lg:table-cell">{l.agent?.name ?? "—"}</td>
                    <td className={`hidden px-4 py-3 whitespace-nowrap sm:table-cell ${OPEN.includes(l.stage) && quiet(l.last_contact_at) ? "font-medium text-danger" : "text-muted"}`}>
                      {l.last_contact_at ? ago(l.last_contact_at) : "—"}
                    </td>
                    <td className="hidden max-w-56 px-4 py-3 xl:table-cell">
                      {l.next_step ? (
                        <span className="block truncate text-fg" title={l.next_step}>
                          {l.next_step} <span className={`text-xs ${Date.parse(l.next_step_at) < Date.now() ? "text-danger" : "text-muted"}`}>· {ago(l.next_step_at)}</span>
                        </span>
                      ) : OPEN.includes(l.stage) ? (
                        <span className="text-xs text-muted">None set</span>
                      ) : null}
                      {l.stage === "reserved" && l.papers_verified < ON_THE_CLOCK.length && (
                        <span className={`block text-xs ${papersDue(l.reserved_at) <= 7 ? "font-medium text-danger" : "text-muted"}`}>
                          Papers {l.papers_verified}/{ON_THE_CLOCK.length} · {papersDue(l.reserved_at) >= 0 ? `${papersDue(l.reserved_at)} days left` : "overdue"}
                        </span>
                      )}
                    </td>
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
