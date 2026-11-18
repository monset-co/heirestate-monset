// CSV for exports and the monthly report. A cell that starts like a formula (= + - @) is prefixed
// with ' so a spreadsheet shows it as text instead of running it: data typed into the public forms
// ends up in these files.
const cell = (v) => {
  if (v == null) return "";
  let s = typeof v === "object" ? JSON.stringify(v) : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// columns: [header, (row) => value] pairs, or plain keys
export function toCsv(rows, columns) {
  const cols = columns.map((c) => (Array.isArray(c) ? c : [c, (r) => r[c]]));
  return [cols.map(([h]) => cell(h)).join(","), ...rows.map((r) => cols.map(([, get]) => cell(get(r))).join(","))].join("\r\n");
}

// a download, with a byte-order mark so Excel reads ₱ and ñ right
export function download(name, text) {
  const url = URL.createObjectURL(new Blob(["﻿", text], { type: "text/csv;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// A CSV file's rows, for reading one in the app: quoted cells may hold commas, "" and line breaks.
export function parseCsv(text) {
  text = text.replace(/^﻿/, ""); // Excel's byte-order mark
  const rows = [[]];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') (cell += '"'), i++;
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") rows.at(-1).push(cell), (cell = "");
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      rows.at(-1).push(cell), (cell = ""), rows.push([]);
    } else cell += c;
  }
  rows.at(-1).push(cell);
  return rows.filter((r) => r.length > 1 || r[0] !== "");
}
