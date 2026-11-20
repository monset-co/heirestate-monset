import { ChevronRight, Plus, Search, SlidersHorizontal } from "lucide-react";
import { useMe } from "../me";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { supabase, run, every } from "../supabase";
import { m as motion } from "motion/react";
import { Live, LiveTr, SkeletonRows, spring } from "../motion";
import { Badge, Empty, ErrorNote, Modal, PageHeader, TabPanel, Tabs, btn, card, input, th, Select, useStored } from "../ui";
import LeadForm from "./LeadForm";
import { Chip } from "./Matches";
import { CATEGORIES, ON_THE_CLOCK, OPEN, SITES, STAGES, TEMPS, ago, papersDue, quiet } from "../crm";

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

let cached = null;

export default function Leads() {
  const navigate = useNavigate();
  const me = useMe();
  const [params, setParams] = useSearchParams();
  // the last list seen, at once on coming back from a lead, then refreshed underneath
  const [list, setList] = useState(cached);
  const [error, setError] = useState("");
  const [text, setText] = useState("");
  const stage = params.get("stage") ?? "";
  const listKey = LISTS[params.get("list")] ? params.get("list") : "open";
  const site = params.get("site") ?? "";
  // the tab in the address, else the one used last on this device
  const [lastKind, setLastKind] = useStored("leads-kind", ""); // the tab used last on this device
  const kind = CATEGORIES[params.get("kind")] ? params.get("kind") : CATEGORIES[lastKind] ? lastKind : "pre-selling";
  const [adding, setAdding] = useState(false);
  const [filters, setFilters] = useState(false); // phones: the list, stage and site pickers, folded away
  const filtered = (listKey !== "open") + !!stage + !!site;

  useEffect(() => {
    Promise.all([
      every(() => supabase.from("leads").select("id, name, email, mobile, interest, category, looking_to, property_types, areas, buildings, budget_max, budget, source_site, stage, temperature, reserved_at, agent_id, created_at, agent:admin_users(name), listing:listings(title)").order("created_at", { ascending: false }).order("id")),
      every(() => supabase.from("lead_overview").select("*").order("id")),
    ]).then(([leads, overview]) => {
      const o = new Map(overview.map((r) => [r.id, r]));
      setList((cached = leads.map((l) => ({ ...l, ...o.get(l.id) }))));
    }, (e) => setError(e.message));
  }, []);

  // ponytail: every lead loaded and filtered in the browser; move the search to SQL past a few thousand
  const typed = useDeferredValue(text); // typing stays quick: the filtering catches up a beat behind
  const shown = useMemo(() => {
    const q = typed.trim().toLowerCase();
    return (list ?? []).filter(
      (l) =>
        l.category === kind &&
        LISTS[listKey][1](l, me) &&
        (!stage || l.stage === stage) &&
        (!site || l.source_site === site) &&
        (!q || [l.name, l.email, l.mobile, l.interest, l.listing?.title, ...l.property_types, ...l.areas, ...l.buildings].some((v) => v?.toLowerCase().includes(q)))
    );
  }, [list, typed, stage, site, listKey, me, kind]);
  const set = (k) => (e) => setParams((p) => (e.target.value ? p.set(k, e.target.value) : p.delete(k), p), { replace: true });

  return (
    <>
      <PageHeader title="Leads" sub="Every inquiry: from the sites' forms (each emailed to its agent the moment it arrives), and the ones you add by hand.">
        <button className={btn} onClick={() => setAdding(true)}>
          <Plus className="size-4" aria-hidden /> Add lead
        </button>
      </PageHeader>

      <div className="mt-6">
        <Tabs
          label="Kind of lead"
          items={Object.entries(CATEGORIES).map(([id, t]) => ({ id, title: list ? `${t} ${list.filter((l) => l.category === id && OPEN.includes(l.stage)).length}` : t }))}
          value={kind}
          onChange={(k) => {
            setLastKind(k);
            setParams((p) => (p.set("kind", k), p), { replace: true });
          }}
        />
      </div>

      {/* quick lists as chips from tablets up; on phones they're the Show picker under Filters */}
      <div role="group" aria-label="Quick lists" className="mt-4 hidden flex-wrap gap-2 sm:flex">
        {Object.entries(LISTS).map(([k, [label, test]]) => {
          const n = list?.filter((l) => l.category === kind && test(l, me)).length;
          return (
            <button
              key={k}
              type="button"
              aria-pressed={listKey === k}
              onClick={() => setParams((p) => (k === "open" ? p.delete("list") : p.set("list", k), p), { replace: true })}
              className={`press relative inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors duration-150 ${listKey === k ? "border-navy text-cream" : "border-line bg-surface text-fg hover:border-muted/50"}`}
            >
              {/* the navy plate springs from the last list to this one */}
              {listKey === k && <motion.span layoutId="quick-list" transition={spring} className="absolute -inset-px rounded-full bg-navy" />}
              <span className="relative">{label}</span>
              {n > 0 && k !== "all" && <span className={`relative text-xs tabular-nums ${listKey === k ? "text-cream/70" : "text-muted"}`}>{n}</span>}
            </button>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap gap-3 sm:mt-3">
        <label className="relative min-w-0 flex-1 sm:max-w-xs">
          <span className="sr-only">Search leads</span>
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <input type="search" placeholder="Search name, email, mobile…" value={text} onChange={(e) => setText(e.target.value)} className={`${input} pl-9`} />
        </label>
        <button
          type="button"
          onClick={() => setFilters((f) => !f)}
          aria-expanded={filters}
          aria-controls="lead-filters"
          className={`press relative inline-flex h-10 items-center gap-1.5 rounded-md border px-3 text-sm font-medium sm:hidden ${filters || filtered ? "border-navy text-fg" : "border-line text-muted"}`}
        >
          <SlidersHorizontal className="size-4" aria-hidden /> Filters
          {filtered > 0 && <span className="grid size-5 place-items-center rounded-full bg-navy text-[0.7rem] text-cream tabular-nums">{filtered}</span>}
        </button>
        <div id="lead-filters" className={`w-full flex-col gap-3 sm:flex sm:w-auto sm:flex-row ${filters ? "flex" : "hidden"}`}>
        <Select aria-label="Show" value={listKey} onChange={(e) => setParams((p) => (e.target.value === "open" ? p.delete("list") : p.set("list", e.target.value), p), { replace: true })} className={`${input} sm:hidden`}>
          {Object.entries(LISTS).map(([k, [label, test]]) => {
            const n = list?.filter((l) => l.category === kind && test(l, me)).length;
            return <option key={k} value={k}>{n > 0 && k !== "all" ? `${label} · ${n}` : label}</option>;
          })}
        </Select>
        <Select aria-label="Filter by stage" value={stage} onChange={set("stage")} className={`${input} sm:w-44`}>
          <option value="">Any stage</option>
          {Object.entries(STAGES).map(([k, s]) => <option key={k} value={k}>{s}</option>)}
        </Select>
        <Select aria-label="Filter by site" value={site} onChange={set("site")} className={`${input} sm:w-48`}>
          <option value="">Every site</option>
          {Object.entries(SITES).map(([k, s]) => <option key={k} value={k}>{s}</option>)}
        </Select>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <ErrorNote error={error} />
        <p className="ml-auto hidden flex-wrap items-center gap-1.5 text-xs text-muted sm:flex" aria-label="Legend">
          What they want: <Chip tone="violet">Type</Chip> <Chip tone="sky">Where</Chip> <Chip tone="teal">Building</Chip> <Chip tone="gold">Budget</Chip>
        </p>
      </div>

      <TabPanel key={kind} className={`${card} mt-4 overflow-x-auto`}>
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
                      {/* what they want, in the lead page's colours: type, place, budget */}
                      <span className="mt-1 flex flex-wrap items-center gap-1">
                        {l.property_types.slice(0, 2).map((t) => <Chip key={t} tone="violet">{t}</Chip>)}
                        {l.areas.slice(0, 2).map((a) => <Chip key={a} tone="sky">{a}</Chip>)}
                        {l.buildings.slice(0, 1).map((b) => <Chip key={b} tone="teal">{b}</Chip>)}
                        {l.budget_max ? <Chip tone="gold">≤ ₱{l.budget_max.toLocaleString("en-PH")}</Chip> : null}
                        {!l.property_types.length && !l.areas.length && (l.interest || l.listing?.title) && <span className="truncate text-xs text-muted">{[l.interest, l.listing?.title].filter(Boolean).join(" · ")}</span>}
                      </span>
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
      </TabPanel>

      <Modal open={adding} onClose={() => setAdding(false)} title="Add lead">
        {adding && <LeadForm lead={{ category: kind }} onSaved={(l) => navigate(`/leads/${l.id}`)} />}
      </Modal>
    </>
  );
}
