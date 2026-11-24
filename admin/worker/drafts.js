// Documents Mons drafts from the team's Word templates (the Documents shelf, library bucket). A
// template marks its blanks like {{Client name}}; she fills them from the lead, the inventory and
// the chat, and the draft is the same Word file with only the blanks changed, so letterhead, tables
// and fonts stay as they are. Drafts go to the mons-uploads bucket under drafts/, attached to her
// reply, where they're previewed in the admin and downloaded.
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";

const WORD = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const BLANK = /\{\{\s*([^{}]{1,80}?)\s*\}\}/g;
// the parts of a Word file that hold its words: the body, headers and footers
const TEXT_PART = /^word\/(document|header\d*|footer\d*)\.xml$/;

const unxml = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const xml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function storage(env, token, bucket, path, init = {}) {
  const r = await fetch(`${env.SUPABASE_URL}/storage/v1/object/${bucket}/${path.split("/").map(encodeURIComponent).join("/")}`, {
    ...init,
    headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${token}`, ...init.headers },
  });
  if (!r.ok) throw new Error(`storage ${r.status} ${bucket}/${path}`);
  return r;
}

// One paragraph's text runs, with every {{blank}} replaced. Word often splits a blank over several
// runs ("{{Client" in one, " name}}" in the next), so the paragraph's runs are read as one string;
// a blank's value goes into the run it starts in (keeping that run's look), and its leftover
// characters are taken out of the runs after. Text outside blanks isn't touched.
// A blank with no value is left as it is, so the preview shows what's still missing.
export function fillParagraph(p, values) {
  const runs = [...p.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)];
  if (!runs.length) return p;
  const texts = runs.map((m) => unxml(m[1]));
  const whole = texts.join("");
  if (!whole.includes("{{")) return p;
  const starts = [];
  texts.reduce((at, t) => (starts.push(at), at + t.length), 0);
  const runAt = (i) => starts.findLastIndex((s, k) => s <= i && (i < s + texts[k].length || k === texts.length - 1));
  const hits = [...whole.matchAll(BLANK)].filter((m) => valueOf(values, m[1]) != null).reverse(); // right to left: earlier offsets stay right
  for (const m of hits) {
    const from = m.index;
    const to = m.index + m[0].length;
    const a = runAt(from);
    const b = runAt(to - 1);
    const value = String(valueOf(values, m[1]));
    if (a === b) texts[a] = texts[a].slice(0, from - starts[a]) + value + texts[a].slice(to - starts[a]);
    else {
      const tail = texts[b].slice(to - starts[b]);
      texts[a] = texts[a].slice(0, from - starts[a]) + value;
      for (let k = a + 1; k < b; k++) texts[k] = "";
      texts[b] = tail;
    }
  }
  let i = 0;
  // a value's line breaks become Word line breaks within its run
  return p.replace(/<w:t(?:\s[^>]*)?>[^<]*<\/w:t>/g, () => `<w:t xml:space="preserve">${xml(texts[i++]).replace(/\r?\n/g, '</w:t><w:br/><w:t xml:space="preserve">')}</w:t>`);
}

// blanks matched loosely: "{{ Client Name }}" takes the value given for "client name"
const key = (s) => s.toLowerCase().replace(/\s+/g, " ").trim();
const valueOf = (values, blank) => values[key(blank)];

export function fillXml(doc, values) {
  return doc.replace(/<w:p[ >][\s\S]*?<\/w:p>/g, (p) => fillParagraph(p, values));
}

// the words of a Word file, paragraph by paragraph (blanks show as typed)
export function wordsOf(files) {
  return Object.keys(files)
    .filter((n) => TEXT_PART.test(n))
    .sort((a, b) => (a === "word/document.xml" ? -1 : b === "word/document.xml" ? 1 : a.localeCompare(b)))
    .flatMap((n) => (strFromU8(files[n]).match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? []).map((p) => [...p.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => unxml(m[1])).join("")))
    .filter((t) => t.trim());
}

const blanksIn = (words) => [...new Set([...words.join("\n").matchAll(BLANK)].map((m) => m[1].trim()))];

async function template(env, token, u, id) {
  const [t] = await u.get(`library_files?select=id,file_name,file_path&shelf=eq.documents&id=eq.${Number(id) || 0}`);
  if (!t || !/\.docx$/i.test(t.file_name)) throw Object.assign(new Error(`There's no Word template #${id} in Documents`), { said: true });
  const files = unzipSync(new Uint8Array(await (await storage(env, token, "library", t.file_path)).arrayBuffer()));
  return { t, files };
}

// her tools
export async function listTemplates(u) {
  const rows = await u.get("library_files?select=id,file_name,created_at&shelf=eq.documents&file_name=ilike.*.docx&order=file_name&limit=100");
  return rows.length ? rows : { note: "There are no Word (.docx) files in Documents yet. Upload a template with blanks typed like {{Client name}}." };
}

export async function readTemplate(env, token, u, id) {
  const { t, files } = await template(env, token, u, id);
  const words = wordsOf(files);
  const blanks = blanksIn(words);
  return {
    template: t.file_name,
    blanks,
    ...(!blanks.length && { note: "This file has no {{blanks}}: it can't be filled in. Ask for a version with blanks typed like {{Client name}}." }),
    text: words.join("\n").slice(0, 8000),
  };
}

// fills it, saves the draft, and says which blanks are still empty
export async function draft(env, token, u, { template_id, values, file_name }) {
  const { t, files } = await template(env, token, u, template_id);
  // [{ blank, value }], as the model sends them
  const given = Object.fromEntries((Array.isArray(values) ? values : []).map((v) => [key(String(v?.blank ?? "")), String(v?.value ?? "").slice(0, 4000)]).filter(([k, v]) => k && v.trim()));
  const out = {};
  for (const [n, data] of Object.entries(files)) out[n] = TEXT_PART.test(n) ? strToU8(fillXml(strFromU8(data), given)) : data;
  const left = blanksIn(wordsOf(out));
  const name = `${String(file_name || t.file_name.replace(/\.docx$/i, "")).replace(/[^\w .()-]+/g, "_").slice(0, 100)}.docx`;
  const path = `drafts/${crypto.randomUUID()}/${name}`;
  await storage(env, token, "mons-uploads", path, { method: "POST", headers: { "Content-Type": WORD }, body: zipSync(out) });
  return { file: { path, name, type: WORD }, blanks_left: left };
}
