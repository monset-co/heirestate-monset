// Mons speaking first: every 15 minutes the cron looks for what an agent should hear about, and
// Mons writes it into their private chat (mons_messages.thread) and rings their bell. No Gemini:
// plain rules over the database, so it costs nothing. Each thing is said once (mons_nudges).
//   cold     a hot lead nobody has been in touch with for 3 days, with no follow-up set
//   papers   a reserved buyer with a week or less on the 30-day clock and papers still missing
//   overdue  a follow-up reminder left undone a day past its time
//   match    a property added to the inventory in the last day that fits an open lead
import { db } from "./supabase.js";
import { notify } from "./push.js";
import { matches } from "../src/match.js";

const TZ = "Asia/Manila";
const DAY = 864e5;
const q = encodeURIComponent;
const day = (t) => new Date(t).toLocaleDateString("en-PH", { timeZone: TZ, weekday: "short", day: "numeric", month: "short" });
const lead = (l) => `[${l.name}](/leads/${l.id})`;
const PAPERS = 4; // ids, income, reservation, payments: the Contract to Sell comes later (lead_overview)

// What to say, to whom: pure, so mons.test.js-style checks can run it on made-up rows.
export function nudges({ leads, overview, reminders, fresh }, now = Date.now()) {
  const out = [];
  const seen = Object.fromEntries(overview.map((o) => [o.id, o]));
  for (const l of leads) {
    const to = l.agent?.active ? l.agent.email : null;
    const o = seen[l.id];
    if (!to || !o) continue;
    const quiet = now - Date.parse(o.last_contact_at);
    const nextStep = o.next_step_at && Date.parse(o.next_step_at) > now;
    if (l.temperature === "hot" && quiet > 3 * DAY && !nextStep)
      out.push({
        key: `cold:${l.id}:${o.last_contact_at.slice(0, 10)}`,
        to,
        text: `${lead(l)} is hot, but nobody has been in touch for ${Math.floor(quiet / DAY)} days and there's no follow-up set. Want me to add one?`,
      });
    if (l.stage === "reserved" && l.reserved_at && (o.papers_verified ?? 0) < PAPERS) {
      const left = 30 - Math.floor((now - Date.parse(l.reserved_at)) / DAY);
      if (left >= 0 && left <= 7)
        out.push({
          key: `papers:${l.id}:${l.reserved_at.slice(0, 10)}`,
          to,
          text: `${lead(l)} has ${left} day${left === 1 ? "" : "s"} left on the 30-day papers clock, with ${o.papers_verified ?? 0} of ${PAPERS} papers verified.`,
        });
    }
    for (const { p } of matches(l, fresh, 3))
      out.push({
        key: `match:${l.id}:${p.id}`,
        to,
        text: `New on the inventory: [${[p.type, p.building ?? p.location].filter(Boolean).join(", ") || `#${p.id}`}](/inventory?open=${p.id}) fits what ${lead(l)} is looking for.`,
      });
  }
  for (const r of reminders) {
    const to = (r.agent?.active && r.agent.email) || (r.lead?.agent?.active && r.lead.agent.email);
    if (to && r.lead)
      out.push({ key: `overdue:${r.id}`, to, text: `Your follow-up for ${lead({ id: r.lead_id, name: r.lead.name })} has been due since ${day(r.due_at)}: "${r.body}"` });
  }
  return out;
}

// One message per agent with what's new for them, and one ring of their bell.
export async function run(env, now = Date.now()) {
  // working hours only, Manila: a 2am buzz helps nobody, and it all keeps until 8
  const hour = Number(new Date(now).toLocaleString("en-US", { timeZone: TZ, hour: "numeric", hourCycle: "h23" }));
  if (hour < 8 || hour >= 20) return;
  const d = db(env);
  const iso = (ms) => q(new Date(ms).toISOString());
  const [leads, reminders, fresh] = await Promise.all([
    d.get(
      "leads?select=id,name,stage,temperature,reserved_at,looking_to,property_types,areas,buildings,near,near_km,furnishings,budget_max,needed_by,priorities,agent:admin_users(email,active)" +
        "&stage=in.(new,contacted,viewing,reserved)&agent_id=not.is.null&limit=2000"
    ),
    // a day late, but not ancient: turning this on mustn't bring up every forgotten one at once
    d.get(`reminders?select=id,body,due_at,lead_id,agent:admin_users(email,active),lead:leads(name,agent:admin_users(email,active))&done_at=is.null&due_at=lt.${iso(now - DAY)}&due_at=gt.${iso(now - 14 * DAY)}&limit=200`),
    d.get(`inventory?select=id,status,type,location,building,lat,lng,furnishing,price,price_text,available,available_from&created_at=gt.${iso(now - DAY)}&limit=200`),
  ]);
  // ponytail: one in.() list of every open lead; chunk it if open leads ever run into the thousands
  const overview = leads.length ? await d.get(`lead_overview?select=id,last_contact_at,next_step_at,papers_verified&id=in.(${leads.map((l) => l.id).join(",")})`) : [];
  const all = nudges({ leads, overview, reminders, fresh }, now);
  if (!all.length) return;
  // claimed first: only the keys not said before come back, so overlapping runs can't both say it
  const claimed = await d.call("mons_nudges?on_conflict=key", {
    method: "POST",
    body: JSON.stringify(all.map(({ key }) => ({ key }))),
    headers: { Prefer: "return=representation,resolution=ignore-duplicates" },
  });
  const isNew = new Set(claimed.map((c) => c.key));
  const byAgent = {};
  for (const n of all) if (isNew.has(n.key)) (byAgent[n.to] ??= []).push(n);
  for (const [to, list] of Object.entries(byAgent)) {
    try {
      const body = list.length === 1 ? list[0].text : `A few things for you:\n${list.map((n) => `- ${n.text}`).join("\n")}`;
      await d.insert("mons_messages", { thread: to, author: to, from_mons: true, body });
      const plain = (t) => t.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
      await notify(env, to, { title: list.length === 1 ? "Mons" : `Mons: ${list.length} things for you`, body: plain(list[0].text), url: "/mons?chat=me" });
    } catch (e) {
      console.error("mons nudge", to, e);
    }
  }
  // the keys of three months back can go: none of the rules looks that far
  await d.remove(`mons_nudges?created_at=lt.${iso(now - 90 * DAY)}`);
}
