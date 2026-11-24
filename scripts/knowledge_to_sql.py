"""The knowledge base (knowledge/*.md) as SQL for the knowledge_* tables.

    python scripts/knowledge_to_sql.py > knowledge-load.sql

then paste it into Supabase > SQL editor and run it. Safe to run again after editing: each file's
passages are replaced, and the admin Worker's cron embeds them within 15 minutes.
ponytail: replacing re-embeds a whole file's passages; diff by heading if the base gets large.

A file:

    ---
    scope: shared            (or a client's own, e.g. heirestates)
    title: Maceda Law refunds
    source: RA 6552 (Maceda Law)
    source_url: https://...
    valid_as_of: 2026-11-24
    status: draft            (draft | reviewed | retired)
    reviewed_by:             (the licensed broker who checked it)
    ---

    ## A passage's heading (unique across the whole base)
    step: papers             (optional: the process step it belongs to)
    next: Another heading    (optional links: next, requires, see-also; repeat as needed)

    The passage itself, a few short paragraphs or bullets.
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent / "knowledge"
LINKS = ("next", "requires", "see-also")
DOC_KEYS = ("scope", "title", "source", "source_url", "valid_as_of", "status", "reviewed_by")


def lit(v):
    return "null" if v in (None, "") else "'" + str(v).replace("'", "''") + "'"


def parse(path):
    text = path.read_text(encoding="utf-8").replace("\r\n", "\n")
    m = re.match(r"---\n(.*?)\n---\n(.*)", text, re.S)
    if not m:
        sys.exit(f"{path.name}: no --- header ---")
    doc = dict(re.findall(r"^([a-z_]+):[ \t]*(.*)$", m.group(1), re.M))
    chunks = []
    for part in re.split(r"^## ", m.group(2), flags=re.M)[1:]:
        heading, _, rest = part.partition("\n")
        meta, links, lines = {}, [], rest.strip("\n").split("\n")
        while lines and (k := re.match(r"^(step|next|requires|see-also):\s*(.+)$", lines[0])):
            (links.append((k[1], k[2].strip())) if k[1] in LINKS else meta.__setitem__(k[1], k[2].strip()))
            lines.pop(0)
        body = "\n".join(lines).strip()
        if not body:
            sys.exit(f"{path.name}: “{heading}” has no text")
        chunks.append({"heading": heading.strip(), "step": meta.get("step"), "body": body, "links": links})
    return doc, chunks


def main():
    files = sorted(ROOT.glob("*.md"))
    parsed = [(f.stem, *parse(f)) for f in files]
    seen = {}
    for slug, _, chunks in parsed:
        for c in chunks:
            if c["heading"] in seen:
                sys.exit(f"“{c['heading']}” is in both {seen[c['heading']]} and {slug}: headings must be unique")
            seen[c["heading"]] = slug
    for slug, _, chunks in parsed:
        for c in chunks:
            for rel, to in c["links"]:
                if to not in seen:
                    sys.exit(f"{slug}: “{c['heading']}” links to “{to}”, which no file has")

    out = ["begin;"]
    for slug, doc, chunks in parsed:
        cols = ", ".join(k for k in DOC_KEYS if doc.get(k))
        vals = ", ".join(lit(doc[k]) for k in DOC_KEYS if doc.get(k))
        sets = ", ".join(f"{k} = excluded.{k}" for k in DOC_KEYS if doc.get(k))
        out.append(f"insert into knowledge_docs (slug, {cols}) values ({lit(slug)}, {vals}) on conflict (slug) do update set {sets}, updated_at = now();")
        out.append(f"delete from knowledge_chunks where doc_id = (select id from knowledge_docs where slug = {lit(slug)});")
        for c in chunks:
            out.append(
                f"insert into knowledge_chunks (doc_id, step, heading, body) values ((select id from knowledge_docs where slug = {lit(slug)}), {lit(c['step'])}, {lit(c['heading'])}, {lit(c['body'])});"
            )
    for slug, _, chunks in parsed:
        for c in chunks:
            for rel, to in c["links"]:
                out.append(
                    f"insert into knowledge_links (from_chunk, to_chunk, relation) select a.id, b.id, {lit(rel)} from knowledge_chunks a, knowledge_chunks b where a.heading = {lit(c['heading'])} and b.heading = {lit(to)} on conflict do nothing;"
                )
    out.append("commit;")
    print("\n".join(out))
    print(f"-- {len(parsed)} files, {sum(len(c) for _, _, c in parsed)} passages", file=sys.stderr)


if __name__ == "__main__":
    main()
