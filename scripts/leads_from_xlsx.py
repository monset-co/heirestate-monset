"""The team's current inquiries (the "CLF" sheet of the Property Listings Library) as SQL for leads.

    python scripts/leads_from_xlsx.py "Property Listings Library.xlsx" > leads-import.sql

then paste the file into Supabase > SQL editor and run it, before …_lead_wants.sql (which sorts the
columns it fills into the fixed choices). Anyone already in, by name, is skipped. The output holds clients' names and
numbers: don't commit it, and delete it once it's in. Needs openpyxl (pip install openpyxl).
"""
import datetime
import json
import re
import sys

import openpyxl

SHEET = "CLF"
SOURCES = {"whatsapp": "whatsapp", "rph": "rph", "fh": "fh", "facebook": "facebook", "fb": "facebook"}
KINDS = {"for rent": "rentals", "for sale": "brokerage", "pre-selling": "pre-selling", "preselling": "pre-selling"}
EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
PHONE = re.compile(r"\(?\+?\d[\d\s()\-]{7,}\d")


def text(v, limit=None):
    if v is None:
        return None
    s = (v.date().isoformat() if isinstance(v, datetime.datetime) else str(v)).strip()
    return (s[:limit] if limit else s) or None


def money(v):
    if isinstance(v, (int, float)):
        return f"₱{round(v):,}"
    return text(v)


def lead(v):
    contact = text(v[3]) or ""
    emails = EMAIL.findall(contact)
    rest = EMAIL.sub("", contact)
    phones = [p.strip() for p in PHONE.findall(rest)]
    sources = [s.strip().lower() for s in str(v[2] or "").split(",") if s.strip()]
    notes = [
        ("Budget", money(v[7])),
        ("Price note", text(v[8])),
        ("Specs", text(v[10])),
        ("Inclusions", text(v[11])),
        ("Other notes", text(v[13])),
        ("Summary", text(v[14])),
        ("Other numbers", ", ".join(phones[1:]) or None),
        ("Other emails", ", ".join(emails[1:]) or None),
        ("Came from", text(v[2]) if len(sources) > 1 else None),
    ]
    return {
        "name": re.sub(r"\s+", " ", text(v[1]))[:100],
        "mobile": phones[0] if phones else "",
        "email": emails[0].lower() if emails else None,
        "source_site": SOURCES.get(sources[0], "other") if sources else "other",
        "category": KINDS.get((text(v[5]) or "").lower(), "rentals"),
        "interest": text(v[5], 120),
        "property_type": text(v[4], 200),
        "location": text(v[6], 300),
        "furnishing": text(v[9], 200),
        "target_date": text(v[12], 120),
        "budget": " ".join(filter(None, [money(v[7]), f"({text(v[8])})" if text(v[8]) else None]))[:80] or None,
        "message": "\n".join(f"{k}: {x}" for k, x in notes if x)[:2000] or None,
        "stage": "contacted",  # "Active Search": we're already looking for them
    }


def main(path):
    ws = openpyxl.load_workbook(path, data_only=True)[SHEET]
    rows = [lead([c.value for c in r]) for r in ws.iter_rows(min_row=2, max_col=15) if text(r[1].value)]
    body = json.dumps(rows, ensure_ascii=False)
    assert "$leads$" not in body
    cols = ", ".join(rows[0].keys())
    sys.stdout.reconfigure(encoding="utf-8")
    print(f"-- {len(rows)} inquiries from the {SHEET!r} sheet, {datetime.date.today()}")
    # run it twice and nothing doubles: anyone already in, by name, is skipped
    print(f"insert into leads ({cols})\nselect {cols} from jsonb_populate_recordset(null::leads, $leads${body}$leads$::jsonb) x\n"
          f"where not exists (select 1 from leads l where lower(l.name) = lower(x.name));")


if __name__ == "__main__":
    main(sys.argv[1])
