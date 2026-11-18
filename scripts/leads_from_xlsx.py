"""The team's current inquiries (the "CLF" sheet of the Property Listings Library) as SQL for leads.

    python scripts/leads_from_xlsx.py "Property Listings Library.xlsx" > leads-import.sql

then paste the file into Supabase > SQL editor and run it. Each lead's wants are sorted into the
fixed choices the admin picks from (the rules …_lead_wants.sql used), the words as typed kept in
the notes. Anyone already in, by name, is skipped. The output holds clients' names and
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

# The fixed choices a lead's wants are sorted into: the same rules as …_lead_wants.sql
LOOKING_TO = {"rentals": ["Rent"], "brokerage": ["Buy resale"], "pre-selling": ["Buy pre-selling"]}
TYPES = {
    "Condo": r"condo|studio|loft|apartment",
    "House & Lot": r"house|h&l|bungalow|duplex|detached|attached|mansion",
    "Townhouse": r"townhouse|rowhouse",
    "Lot": r"(^|,\s*)(corner |farm |residential )?lot\s*(,|$)",
    "Commercial": r"commercial|office|warehouse|building|hotel",
    "Studio": r"studio",
    "1BR": r"\b1\s?BR",
    "2BR": r"\b2\s?BR",
    "3BR+": r"\b([3-9]|1\d)\s?BR",
}
CITY_AREAS = {
    "IT Park": r"it park|apas", "Lahug": r"lahug|nivel", "Banilad": r"banilad", "Talamban": r"talamban",
    "Mabolo": r"mabolo", "Cebu Business Park": r"business park|ayala|cbp", "Kasambagan": r"kasambagan",
    "Guadalupe": r"guadalupe", "Banawa": r"banawa", "Busay": r"busay", "Capitol / Fuente": r"capitol|fuente|osme[ñn]a|ramos",
    "Labangon": r"labangon", "Tisa": r"tisa",
}
AREAS = {**CITY_AREAS,
    "Mandaue": r"mandaue", "Lapu-Lapu / Mactan": r"lapu|mactan", "Talisay": r"talisay", "Minglanilla": r"minglanilla",
    "Consolacion": r"consolacion", "Liloan": r"liloan", "Cordova": r"cordova", "Naga": r"naga",
}
FURNISHINGS = {
    "Fully furnished": r"fully furnished", "Furnished": r"(^|,\s*)furnished", "Semi-furnished": r"semi",
    "Finished": r"(^|,\s*)finished", "Unfurnished": r"unfurnished",
}


def pick(choices, s):
    return [k for k, rx in choices.items() if s and re.search(rx, s, re.I)]


def areas(where):
    found = pick(AREAS, where)
    # "Cebu City" with no district named: anywhere in it
    if where and re.search("cebu city", where, re.I) and not set(found) & CITY_AREAS.keys():
        found.append("Anywhere in Cebu City")
    return found


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
    kind = KINDS.get((text(v[5]) or "").lower(), "rentals")
    kind_text, where, furnishing, when = text(v[4], 200), text(v[6], 300), text(v[9], 200), text(v[12], 120)
    budget = " ".join(filter(None, [money(v[7]), f"({text(v[8])})" if text(v[8]) else None]))
    written = [(k, x) for k, x in [("type", kind_text), ("where", where), ("furnishing", furnishing), ("when", when)] if x]
    return {
        "name": re.sub(r"\s+", " ", text(v[1]))[:100],
        "mobile": phones[0] if phones else "",
        "email": emails[0].lower() if emails else None,
        "source_site": SOURCES.get(sources[0], "other") if sources else "other",
        "category": kind,
        "interest": text(v[5], 120),
        "looking_to": LOOKING_TO[kind],
        "property_types": pick(TYPES, kind_text),
        "areas": areas(where),
        "furnishings": pick(FURNISHINGS, furnishing),
        "budget_max": max((int(n.replace(",", "")) for n in re.findall(r"\d[\d,]{3,}", budget)), default=None),
        "needed_by": when if when and re.fullmatch(r"\d{4}-\d{2}-\d{2}", when) else None,
        "budget": budget[:80] or None,
        "message": "\n\n".join(filter(None, [
            "\n".join(f"{k}: {x}" for k, x in notes if x),
            # the words as they were typed, so nothing said is lost (as …_lead_wants.sql does)
            "As first written: " + "; ".join(f"{k} {x}" for k, x in written) if written else None,
        ]))[:2000] or None,
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
