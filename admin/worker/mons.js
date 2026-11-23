// Mons, the admin's assistant: a Gemini model (through Cloudflare's AI Gateway) with tools that read
// the admin's own data the moment she's asked: leads, inventory, reminders, tasks, bookings,
// documents. Nothing is copied or indexed ahead of time, so she's never out of date. She reads as
// the person asking (their sign-in token), so row-level security keeps their private notes theirs.
// Small changes (notes, reminders, tasks, ticking them off, hot/warm/cold) she makes herself and
// lists under her reply; bigger ones (a stage, the agent, a booking) she proposes, and someone
// presses Confirm (POST /api/mons/confirm).
import { db } from "./supabase.js";
import * as google from "./google.js";
import { notify } from "./push.js";

const TZ = "Asia/Manila";
const ROUNDS = 6; // tool calls per answer at most, so a confused model can't loop up a bill
const HISTORY = 20; // earlier messages she sees
const MAX_RESULT = 12000; // characters of one tool's result
const q = encodeURIComponent;
const OPEN = ["new", "contacted", "viewing", "reserved"];
const INV_STATUS = ["Pre-selling", "For Rent", "Rented", "For Sale", "Sold", "For Assume", "Reserved", "Unavailable"];

// her monthly token cap: the mons_monthly_tokens setting, else 5 million
export const DEFAULT_CAP = 5_000_000;
export const monthlyCap = (v) => (Number(v) > 0 ? Math.floor(Number(v)) : DEFAULT_CAP);

const json = (data, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });

// words someone typed, made safe inside a PostgREST or=(…) filter
export const term = (s) => String(s ?? "").replace(/[,()*\\:"']/g, " ").trim().slice(0, 80);
const like = (cols, s) => `or=(${cols.map((c) => `${c}.ilike.*${q(s)}*`).join(",")})`;

export function persona({ me, team, now }) {
  return `You are Mons, the personal assistant inside the Heir Estates admin, a real estate brokerage in Metro Cebu, Philippines.
You are a secretary: warm, eager to help and thoroughly professional. Short, clear answers, like a capable assistant messaging her boss. Mirror the language you're written in (English, Tagalog, Cebuano or a mix).

It is ${now} in Manila. You're talking with ${me.name} (${me.email}). This is the team's shared chat, so each message says who wrote it.
The team: ${team.map((t) => `${t.name} <${t.email}>`).join("; ")}.

How you work:
- Look things up with your tools before answering. Never invent a lead, property, price, date or file. If a tool finds nothing, say so.
- Lead stages: new, contacted, viewing, reserved (these four are "open"), closed, lost. Hot/warm/cold is a lead's temperature. A reserved buyer has 30 days to complete their papers.
- Link every lead you mention as a Markdown link, [Name](/leads/<id>). Other pages: /inventory, /calendar, /notes, /documents, /whatsapp.
- Format for a chat bubble: short lines, "- " bullets, **bold** sparingly. No headings, tables or dividers.
- Peso amounts as ₱1,234,567. Dates in plain words ("Fri 28 Nov, 3pm").
- For a debriefing, cover: reminders due or overdue, today's and tomorrow's bookings, hot and reserved leads, and tasks that are urgent or due.
- You can act. Small things you do straight away when asked: add a note, a reminder or a task, tick a reminder or task off, set hot/warm/cold. Bigger things you propose and a person confirms with a button under your message: changing a stage, reassigning the agent, booking on the calendar. Say plainly what you did, and what is waiting for their Confirm.
- Only act on what you were asked. If something you need is unclear (which lead, what time), ask first instead of guessing. Never say something is done unless the tool said so.
- Times you pass to tools are Manila time, written YYYY-MM-DDTHH:MM. "Tomorrow morning" with no time given: 9:00. A viewing with no length given: one hour.
- A task with no person named is the asker's own (assignee_email = their email). "Anyone" means no assignee.
- Client details are personal data under the Data Privacy Act: share them only inside this admin, never suggest posting them elsewhere.`;
}

// what she may do herself, and what waits for Confirm
const SMALL = ["add_note", "add_reminder", "complete_reminder", "add_task", "complete_task", "set_temperature"];
const BIG = ["set_stage", "assign_agent", "book"];
const WRITES = 10; // changes and proposals in one answer at most

const ACT_TOOLS = [
  {
    name: "add_note",
    description: "Add a sticky note to a lead. Pinned notes show on every tab of the lead.",
    parameters: { type: "object", properties: { lead_id: { type: "integer" }, text: { type: "string" }, pinned: { type: "boolean" } }, required: ["lead_id", "text"] },
  },
  {
    name: "add_reminder",
    description: "Set a follow-up reminder on a lead. It's emailed to the lead's agent when due.",
    parameters: {
      type: "object",
      properties: { lead_id: { type: "integer" }, due: { type: "string", description: "Manila time, YYYY-MM-DDTHH:MM" }, text: { type: "string", description: "What to do" } },
      required: ["lead_id", "due", "text"],
    },
  },
  { name: "complete_reminder", description: "Tick a reminder off as done.", parameters: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] } },
  {
    name: "add_task",
    description: "Put a task on the Notes board.",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string" },
        assignee_email: { type: "string", description: "Whose task. Empty for Anyone." },
        due_on: { type: "string", description: "YYYY-MM-DD" },
        urgent: { type: "boolean" },
        lead_id: { type: "integer", description: "The client it's about, if any" },
      },
      required: ["text"],
    },
  },
  { name: "complete_task", description: "Tick a task off as done.", parameters: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] } },
  {
    name: "set_temperature",
    description: "Tag a lead hot, warm or cold, or clear it.",
    parameters: { type: "object", properties: { lead_id: { type: "integer" }, temperature: { type: "string", enum: ["hot", "warm", "cold", "none"] } }, required: ["lead_id", "temperature"] },
  },
  {
    name: "set_stage",
    description: "PROPOSE moving a lead to another stage; a person confirms. Reserved starts the 30-day papers clock.",
    parameters: {
      type: "object",
      properties: { lead_id: { type: "integer" }, stage: { type: "string", enum: [...OPEN, "closed", "lost"] }, lost_reason: { type: "string", description: "Needed for lost" } },
      required: ["lead_id", "stage"],
    },
  },
  {
    name: "assign_agent",
    description: "PROPOSE giving a lead to another agent; a person confirms.",
    parameters: { type: "object", properties: { lead_id: { type: "integer" }, agent_email: { type: "string" } }, required: ["lead_id", "agent_email"] },
  },
  {
    name: "book",
    description: "PROPOSE a booking on the business Google Calendar (a viewing, a meeting); a person confirms. Guests get Google's invitation.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "e.g. 'Viewing: Ana Reyes, Avida Riala 12F'" },
        start: { type: "string", description: "Manila time, YYYY-MM-DDTHH:MM" },
        end: { type: "string", description: "Manila time, YYYY-MM-DDTHH:MM" },
        lead_id: { type: "integer" },
        location: { type: "string" },
        notes: { type: "string" },
        guests: { type: "array", items: { type: "string" }, description: "Emails to invite" },
      },
      required: ["title", "start", "end"],
    },
  },
];

const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const fail = (error) => Object.assign(new Error(error), { said: true }); // a refusal worded for her to pass on

// The changes themselves, as the person asking (their row-level security, their name in the activity
// log). Each returns what to say it did, and where. Used for her own small changes and for a
// confirmed proposal alike.
export function actions(env, token, me, team) {
  const u = db(env, token);
  const lead = async (id) => {
    const [l] = await u.get(`leads?select=id,name,agent_id,stage&id=eq.${Number(id)}`);
    if (!l) throw fail(`There's no lead #${id}`);
    return l;
  };
  const person = (email) => team.find((t) => t.email === String(email ?? "").trim().toLowerCase());
  const at = (l) => `/leads/${l.id}`;
  return {
    lead,
    person,
    async add_note({ lead_id, text, pinned }) {
      const l = await lead(lead_id);
      const body = String(text ?? "").trim().slice(0, 4000);
      if (!body) throw fail("The note is empty");
      await u.insert("lead_notes", { lead_id: l.id, body, ...(pinned && { pinned: true }) });
      return { text: `${pinned ? "Pinned" : "Added"} a note on ${l.name}: “${body.slice(0, 80)}”`, url: at(l) };
    },
    async add_reminder({ lead_id, due, text }) {
      const l = await lead(lead_id);
      if (!TIME.test(due ?? "")) throw fail("The reminder needs a date and time");
      const body = String(text ?? "").trim().slice(0, 1000);
      if (!body) throw fail("Say what the reminder is for");
      await u.insert("reminders", { lead_id: l.id, agent_id: l.agent_id, due_at: new Date(`${due}:00+08:00`).toISOString(), body });
      return { text: `Set a reminder on ${l.name} for ${say(due)}: “${body.slice(0, 80)}”`, url: at(l) };
    },
    async complete_reminder({ id }) {
      const [r] = await u.update(`reminders?id=eq.${Number(id)}&done_at=is.null&select=body,lead_id,leads(name)`, { done_at: new Date().toISOString() });
      if (!r) throw fail(`Reminder #${id} isn't open`);
      return { text: `Ticked off the reminder on ${r.leads?.name ?? "a lead"}: “${r.body.slice(0, 80)}”`, url: `/leads/${r.lead_id}` };
    },
    async add_task({ text, assignee_email, due_on, urgent, lead_id }) {
      const body = String(text ?? "").trim().slice(0, 4000);
      if (!body) throw fail("The task is empty");
      const who = assignee_email ? person(assignee_email) : null;
      if (assignee_email && !who) throw fail(`${assignee_email} isn't on the team`);
      const l = lead_id ? await lead(lead_id) : null;
      const [t] = await u.insert("tasks", {
        body,
        private: false,
        assignee: who?.email ?? null,
        due_on: /^\d{4}-\d{2}-\d{2}$/.test(due_on ?? "") ? due_on : null,
        urgent: !!urgent,
        lead_id: l?.id ?? null,
      });
      if (who && who.email !== me.email) await notify(env, who.email, { title: `${urgent ? "Urgent: " : ""}${me.admin.name} gave you a task`, body: body.slice(0, 200), url: "/notes" }).catch(() => {});
      return { text: `Added a task for ${who ? (who.email === me.email ? "you" : who.name) : "Anyone"}: “${t.body.slice(0, 80)}”`, url: "/notes" };
    },
    async complete_task({ id }) {
      const [t] = await u.update(`tasks?id=eq.${Number(id)}&done_at=is.null`, { done_at: new Date().toISOString() });
      if (!t) throw fail(`Task #${id} isn't open`);
      return { text: `Ticked off the task “${t.body.slice(0, 80)}”`, url: "/notes" };
    },
    async set_temperature({ lead_id, temperature }) {
      const l = await lead(lead_id);
      const t = ["hot", "warm", "cold"].includes(temperature) ? temperature : null;
      await u.update(`leads?id=eq.${l.id}`, { temperature: t });
      return { text: t ? `Tagged ${l.name} ${t}` : `Cleared ${l.name}'s hot/warm/cold tag`, url: at(l) };
    },
    async set_stage({ lead_id, stage, lost_reason }) {
      const l = await lead(lead_id);
      if (![...OPEN, "closed", "lost"].includes(stage)) throw fail(`${stage} isn't a stage`);
      const reason = String(lost_reason ?? "").trim().slice(0, 500);
      if (stage === "lost" && !reason) throw fail("Say why the lead was lost");
      await u.update(`leads?id=eq.${l.id}`, { stage, lost_reason: stage === "lost" ? reason : null });
      return { text: `Moved ${l.name} from ${l.stage} to ${stage}`, url: at(l) };
    },
    async assign_agent({ lead_id, agent_email }) {
      const l = await lead(lead_id);
      const who = person(agent_email);
      if (!who) throw fail(`${agent_email} isn't on the team`);
      await u.update(`leads?id=eq.${l.id}`, { agent_id: who.id });
      if (who.email !== me.email) await notify(env, who.email, { title: `${me.admin.name} gave you a lead`, body: l.name, url: at(l) }).catch(() => {});
      return { text: `Gave ${l.name} to ${who.name}`, url: at(l) };
    },
    async book(b) {
      const l = b.lead_id ? await lead(b.lead_id) : null;
      const r = await google.book(new Request("https://mons.internal/", { method: "POST", body: JSON.stringify({ ...b, lead_id: l?.id }) }), env, me);
      const out = await r.json();
      if (!r.ok) throw fail(out.error ?? "The calendar refused it");
      return { text: `Booked “${String(b.title).slice(0, 80)}” for ${say(b.start)}`, url: "/calendar" };
    },
  };
}

// what a proposal will do, in words, checked before it's offered so Confirm rarely fails
async function propose(kind, args, run) {
  if (kind === "book") {
    const f = google.fields(args);
    if (f.error) throw fail(f.error);
    return { summary: `Book “${String(args.title).slice(0, 80)}”, ${say(args.start)} to ${args.end?.slice(11)}${args.location ? ` at ${args.location}` : ""}`, url: "/calendar" };
  }
  const l = await run.lead(args.lead_id);
  if (kind === "set_stage") {
    if (args.stage === "lost" && !String(args.lost_reason ?? "").trim()) throw fail("Say why the lead was lost");
    return { summary: `Move ${l.name} from ${l.stage} to ${args.stage}${args.lost_reason ? ` (${args.lost_reason})` : ""}`, url: `/leads/${l.id}` };
  }
  const who = run.person(args.agent_email);
  if (!who) throw fail(`${args.agent_email} isn't on the team`);
  return { summary: `Give ${l.name} to ${who.name}`, url: `/leads/${l.id}` };
}

// "2026-11-24T15:00" as "Mon 24 Nov, 3:00 PM"
export const say = (t) => new Date(`${t}:00+08:00`).toLocaleString("en-PH", { timeZone: TZ, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
// ── tools ──────────────────────────────────────────────────────────────────────────────────────
const TOOLS = [
  {
    name: "search_leads",
    description: "Find leads (clients and inquiries), newest activity first. All filters optional.",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string", description: "Part of a name, mobile, email, or what they asked about" },
        stage: { type: "string", enum: ["open", ...OPEN, "closed", "lost"] },
        temperature: { type: "string", enum: ["hot", "warm", "cold"] },
        agent_email: { type: "string", description: "Only this agent's leads" },
        limit: { type: "integer", description: "Default 20, at most 50" },
      },
    },
  },
  {
    name: "get_lead",
    description: "Everything about one lead: details, notes, open reminders, papers checklist, files, and their latest WhatsApp messages.",
    parameters: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] },
  },
  {
    name: "search_inventory",
    description: "Properties the team can offer (private, not the public listings). All filters optional.",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string", description: "Words in its type, location, building, specs or summary, e.g. 'studio', 'IT Park', '2BR'" },
        status: { type: "string", enum: INV_STATUS },
        min_price: { type: "integer", description: "Pesos" },
        max_price: { type: "integer", description: "Pesos" },
        limit: { type: "integer", description: "Default 15, at most 40" },
      },
    },
  },
  {
    name: "list_reminders",
    description: "Follow-up reminders set on leads, not yet done.",
    parameters: {
      type: "object",
      properties: {
        when: { type: "string", enum: ["due", "next_7_days"], description: "due: today or overdue (default)" },
        agent_email: { type: "string" },
      },
    },
  },
  {
    name: "list_tasks",
    description: "Tasks on the Notes board (and the asker's own private notes).",
    parameters: {
      type: "object",
      properties: {
        assignee_email: { type: "string", description: "Only this person's tasks" },
        include_done: { type: "boolean" },
      },
    },
  },
  {
    name: "list_bookings",
    description: "Bookings on the business Google Calendar (viewings, meetings) between two dates.",
    parameters: {
      type: "object",
      properties: {
        from: { type: "string", description: "YYYY-MM-DD, default today" },
        to: { type: "string", description: "YYYY-MM-DD, default 7 days on" },
      },
    },
  },
  {
    name: "list_documents",
    description: "The team's shared files: Documents (forms, price lists, spreadsheets) and Presentations (client decks). Names only for now.",
    parameters: { type: "object", properties: { shelf: { type: "string", enum: ["documents", "presentations"] } } },
  },
];

const manilaDate = (d = new Date()) => d.toLocaleDateString("en-CA", { timeZone: TZ });
const clamp = (n, d, max) => Math.min(Math.max(Number(n) || d, 1), max);

function tools(env, token, team) {
  const u = db(env, token);
  const agentId = (email) => team.find((t) => t.email === String(email).toLowerCase())?.id;
  const agentName = (id) => team.find((t) => t.id === id)?.name ?? null;
  return {
    async search_leads({ text, stage, temperature, agent_email, limit }) {
      const f = ["select=id,name,mobile,email,stage,temperature,category,looking_to,budget,interest,agent_id,source_site,created_at,updated_at", "order=updated_at.desc", `limit=${clamp(limit, 20, 50)}`];
      if (term(text)) f.push(like(["name", "mobile", "email", "interest", "message"], term(text)));
      if (stage === "open") f.push(`stage=in.(${OPEN})`);
      else if (stage) f.push(`stage=eq.${q(stage)}`);
      if (temperature) f.push(`temperature=eq.${q(temperature)}`);
      if (agent_email) f.push(`agent_id=eq.${agentId(agent_email) ?? 0}`);
      const rows = await u.get(`leads?${f.join("&")}`);
      return rows.map(({ agent_id, ...r }) => ({ ...r, agent: agentName(agent_id) }));
    },
    async get_lead({ id }) {
      id = Number(id);
      const [[lead], notes, reminders, checklist, files, threads] = await Promise.all([
        u.get(`leads?id=eq.${id}`),
        u.get(`lead_notes?select=body,pinned,author_email,created_at&lead_id=eq.${id}&order=created_at.desc&limit=15`),
        u.get(`reminders?select=id,due_at,body,agent_id&lead_id=eq.${id}&done_at=is.null&order=due_at`),
        u.get(`lead_checklist?select=item,status,reason&lead_id=eq.${id}`),
        u.get(`lead_files?select=folder,file_name,created_at&lead_id=eq.${id}&order=created_at.desc&limit=40`),
        u.get(`wa_threads?select=id&lead_id=eq.${id}`),
      ]);
      if (!lead) return { error: `No lead #${id}` };
      const wa = threads[0]
        ? (await u.get(`wa_messages?select=direction,body,type,created_at&thread_id=eq.${threads[0].id}&order=created_at.desc&limit=10`)).reverse()
        : [];
      return { ...lead, agent: agentName(lead.agent_id), notes, reminders, papers: checklist, files, whatsapp: wa };
    },
    async search_inventory({ text, status, min_price, max_price, limit }) {
      const f = ["select=id,status,type,location,building,price,price_text,available,available_from,furnishing,specs,pet_friendly,summary", "order=updated_at.desc", `limit=${clamp(limit, 15, 40)}`];
      if (term(text)) f.push(like(["type", "location", "building", "specs", "summary", "notes"], term(text)));
      if (INV_STATUS.includes(status)) f.push(`status=cs.${q(`{"${status}"}`)}`);
      if (min_price) f.push(`price=gte.${Number(min_price)}`);
      if (max_price) f.push(`price=lte.${Number(max_price)}`);
      return u.get(`inventory?${f.join("&")}`);
    },
    async list_reminders({ when = "due", agent_email }) {
      const until = when === "next_7_days" ? new Date(Date.now() + 7 * 864e5) : new Date();
      const f = ["select=id,due_at,body,agent_id,lead_id,leads(name,stage)", "done_at=is.null", `due_at=lte.${q(until.toISOString())}`, "order=due_at", "limit=60"];
      if (agent_email) f.push(`agent_id=eq.${agentId(agent_email) ?? 0}`);
      const rows = await u.get(`reminders?${f.join("&")}`);
      return rows.map(({ agent_id, ...r }) => ({ ...r, agent: agentName(agent_id) }));
    },
    async list_tasks({ assignee_email, include_done }) {
      const f = ["select=id,body,assignee,due_on,urgent,done_at,lead_id,private,created_by", "order=due_on.asc.nullslast", "limit=60"];
      if (!include_done) f.push("done_at=is.null");
      if (assignee_email) f.push(`assignee=eq.${q(String(assignee_email).toLowerCase())}`);
      return u.get(`tasks?${f.join("&")}`);
    },
    async list_bookings({ from, to }) {
      const day = /^\d{4}-\d{2}-\d{2}$/;
      const p = new URLSearchParams({ from: day.test(from) ? from : manilaDate(), to: day.test(to) ? to : manilaDate(new Date(Date.now() + 7 * 864e5)) });
      try {
        const { events } = await (await google.events(env, new URL(`https://mons.internal/?${p}`))).json();
        return events.map(({ title, start, end, allDay, location, notes, guests, lead_id }) => ({ title, start, end, allDay, location, notes: notes.slice(0, 300), guests: guests.map((g) => g.email), lead_id }));
      } catch (e) {
        return { error: e.status ? e.message : "The calendar couldn't be read just now" };
      }
    },
    async list_documents({ shelf }) {
      return u.get(`library_files?select=shelf,file_name,created_at&order=created_at.desc&limit=100${shelf ? `&shelf=eq.${q(shelf)}` : ""}`);
    },
  };
}

// ── the model ──────────────────────────────────────────────────────────────────────────────────
// Through the AI Gateway (its logs and costs), else straight to Google. The gateway reaches Google
// from whichever data centre it likes, and Google turns some away ("User location is not
// supported"): in testing from Manila, 5 calls in 6. Those go direct instead.
// ponytail: falls back per call; drop the gateway leg if its logs aren't used.
async function gemini(env, body) {
  const path = `v1beta/models/${env.MONS_MODEL}:generateContent`;
  const init = (extra) => ({ method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY, ...extra }, body: JSON.stringify(body) });
  let r;
  if (env.AI_GATEWAY) {
    r = await fetch(
      `https://gateway.ai.cloudflare.com/v1/${env.CF_ACCOUNT_ID}/${env.AI_GATEWAY}/google-ai-studio/${path}`,
      init(env.CF_AIG_TOKEN && { "cf-aig-authorization": `Bearer ${env.CF_AIG_TOKEN}` })
    );
    if (r.ok) return r.json();
    const error = await r.text();
    if (!/location is not supported/i.test(error)) throw new Error(`Gemini ${r.status}: ${error.slice(0, 500)}`);
  }
  r = await fetch(`https://generativelanguage.googleapis.com/${path}`, init());
  if (!r.ok) throw new Error(`Gemini ${r.status}: ${(await r.text()).slice(0, 500)}`);
  return r.json();
}

// The talk: ask, let her call tools until she has an answer, return her words.
// usage.tokens adds up what each round cost, even if a later round fails.
export async function answer(env, { system, contents, run, usage = { tokens: 0 } }) {
  const body = (c) => ({
    system_instruction: { parts: [{ text: system }] },
    contents: c,
    tools: [{ functionDeclarations: [...TOOLS, ...ACT_TOOLS] }],
    generationConfig: { maxOutputTokens: 4096, thinkingConfig: { thinkingLevel: "low" } }, // a secretary's lookups, not a proof: quicker answers
  });
  for (let round = 0; round < ROUNDS; round++) {
    const out = await gemini(env, body(contents));
    usage.tokens += out.usageMetadata?.totalTokenCount ?? 0;
    const content = out.candidates?.[0]?.content;
    const parts = content?.parts ?? [];
    const calls = parts.filter((p) => p.functionCall);
    if (!calls.length) return parts.filter((p) => p.text && !p.thought).map((p) => p.text).join("").trim() || "Sorry, I lost my train of thought there. Could you ask me again?";
    contents.push(content); // as sent, with its thought signatures, which Gemini needs back
    const results = await Promise.all(
      calls.map(async ({ functionCall: { name, args } }) => {
        let result;
        try {
          result = run[name] ? await run[name](args ?? {}) : { error: `No tool ${name}` };
        } catch (e) {
          console.error("mons tool", name, e);
          result = { error: e.said ? e.message : "That didn't work" };
        }
        const text = JSON.stringify(result);
        return { functionResponse: { name, response: { result: text.length > MAX_RESULT ? `${text.slice(0, MAX_RESULT)}… (cut short: ask for fewer)` : result } } };
      })
    );
    contents.push({ role: "user", parts: results });
  }
  return "That took me more lookups than I'm allowed in one go. Could you narrow it down a little?";
}

// POST /api/mons { text }: save what they wrote, answer it, save the answer. The page shows both
// through realtime, so other people in the chat see them too.
export async function chat(req, env, me, token) {
  if (!env.GEMINI_API_KEY) return json({ error: "Mons isn't set up yet (GEMINI_API_KEY)" }, 501);
  const { text } = await req.json().catch(() => ({}));
  const said = String(text ?? "").trim();
  if (!said || said.length > 4000) return json({ error: "Write a message (up to 4,000 characters)" }, 400);
  const u = db(env, token);
  const [team, earlier, used, [cap]] = await Promise.all([
    u.get("admin_users?select=id,name,email&active=eq.true&order=name"),
    u.get(`mons_messages?select=from_mons,author,body,changes,proposals&order=created_at.desc&limit=${HISTORY}`),
    u.call("rpc/mons_tokens_this_month", { method: "POST", body: "{}" }),
    u.get("settings?select=value&key=eq.mons_monthly_tokens"),
  ]);
  const [mine] = await u.insert("mons_messages", { body: said });
  // the month's cap: past it she says so instead of answering, until the 1st or a higher cap
  if (Number(used) >= monthlyCap(cap?.value)) {
    const [hers] = await u.insert("mons_messages", {
      from_mons: true,
      body: "I'm sorry, I've used this month's allowance and have to stop here until the 1st. An admin can raise my monthly limit in Settings.",
    });
    return json({ messages: [mine, hers] });
  }
  const nameOf = (email) => team.find((t) => t.email === email)?.name ?? email;
  // her earlier replies carry what she did and proposed, so she remembers it
  const recall = (m) =>
    [m.body, ...m.changes.map((c) => `[done: ${c.text}]`), ...m.proposals.map((p) => `[proposed: ${p.summary} (${p.state}${p.by ? ` by ${p.by}` : ""})]`)].join("\n");
  const contents = earlier
    .reverse()
    .map((m) => (m.from_mons ? { role: "model", parts: [{ text: recall(m) }] } : { role: "user", parts: [{ text: `${nameOf(m.author)}: ${m.body}` }] }));
  contents.push({ role: "user", parts: [{ text: `${me.admin.name}: ${said}` }] });
  const now = new Date().toLocaleString("en-PH", { timeZone: TZ, weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "numeric", minute: "2-digit" });

  // her tools: the lookups, then the changes, which are written down as they happen
  const changes = [];
  const proposals = [];
  const act = actions(env, token, me, team);
  const run = tools(env, token, team);
  const room = () => changes.length + proposals.length < WRITES;
  for (const k of SMALL)
    run[k] = async (args) => {
      if (!room()) return { error: "That's enough changes for one message; ask me to carry on in the next" };
      const c = await act[k](args);
      changes.push(c);
      return { done: c.text };
    };
  for (const k of BIG)
    run[k] = async (args) => {
      if (!room()) return { error: "That's enough changes for one message; ask me to carry on in the next" };
      const p = await propose(k, args, act);
      proposals.push({ kind: k, args, ...p, state: "pending" });
      return { waiting_for_confirm: p.summary };
    };

  let reply;
  const usage = { tokens: 0 };
  try {
    reply = await answer(env, { system: persona({ me: { name: me.admin.name, email: me.email }, team, now }), contents, run, usage });
  } catch (e) {
    console.error("mons", e);
    reply = changes.length ? "I made the changes below, then lost my connection before I could finish. Please check them." : "I'm sorry, I couldn't reach my thinking just now. Please try again in a moment.";
  }
  const [hers] = await u.insert("mons_messages", { from_mons: true, body: reply.slice(0, 20000), changes, proposals, tokens: usage.tokens });
  return json({ messages: [mine, hers] });
}

// POST /api/mons/confirm { id, index, ok }: someone pressed Confirm (or Not now) on a proposal.
// It runs as them, and Mons posts what happened.
// ponytail: two people pressing Confirm in the same second could both run it; claim it first
// (compare-and-set on proposals) if that ever happens.
export async function confirm(req, env, me, token) {
  const { id, index, ok } = await req.json().catch(() => ({}));
  const u = db(env, token);
  const [m] = await u.get(`mons_messages?select=id,proposals&from_mons=eq.true&id=eq.${Number(id) || 0}`);
  const p = m?.proposals?.[index];
  if (!p || !BIG.includes(p.kind)) return json({ error: "There's nothing to confirm there" }, 404);
  if (p.state !== "pending") return json({ error: `That was already ${p.state}${p.by ? ` by ${p.by}` : ""}` }, 409);
  p.by = me.admin.name;
  let done = null;
  if (!ok) p.state = "declined";
  else
    try {
      const team = await u.get("admin_users?select=id,name,email&active=eq.true");
      done = await actions(env, token, me, team)[p.kind](p.args);
      Object.assign(p, { state: "done", note: done.text, url: done.url });
    } catch (e) {
      if (!e.said) console.error("mons confirm", e);
      Object.assign(p, { state: "failed", note: e.said ? e.message : "It didn't go through" });
    }
  await u.update(`mons_messages?id=eq.${m.id}`, { proposals: m.proposals });
  if (ok)
    await u.insert("mons_messages", {
      from_mons: true,
      body: done ? `Done, ${me.admin.name.split(" ")[0]}.` : `I'm sorry, that didn't go through: ${p.note}.`,
      changes: done ? [done] : [],
    });
  return json({ ok: true });
}
