"""The team's Property Listings Library sheet ("RPL FB Account") as SQL for the inventory table.

    python scripts/inventory_from_xlsx.py "Property Listings Library.xlsx" > inventory-import.sql

then paste the file into Supabase > SQL editor and run it once. The output holds owners' names and
numbers: don't commit it, and delete it once it's in. Needs openpyxl (pip install openpyxl).
"""
import datetime
import json
import re
import sys

import openpyxl

SHEET = "RPL FB Account"
STATUSES = {"preselling/rfo": "Pre-selling", "preselling": "Pre-selling", "pre-selling": "Pre-selling", "for rent": "For Rent", "rented": "Rented",
            "for sale": "For Sale", "sold": "Sold", "for assume": "For Assume", "reserved": "Reserved", "unavailable": "Unavailable"}


def text(v, limit):
    if v is None or isinstance(v, bool):
        return None
    s = str(v).strip()
    return s[:limit] or None


def flag(v):
    return v is True or str(v).strip().lower() in ("true", "yes", "y", "1")


def url(cell):
    t = cell.hyperlink.target if cell.hyperlink else None
    return t if t and re.match(r"^https?://", t) else None


def day(v):
    return v.date().isoformat() if isinstance(v, datetime.datetime) else None


def row_of(c):
    v = [x.value for x in c]
    notes = [text(v[14], 7000)]
    status = []
    for s in str(v[5] or "").split(","):
        s = STATUSES.get(s.strip().lower())
        if s and s not in status:
            status.append(s)
    # Availability: yes/no, a date it frees up, or now and then words
    available, available_from = None, day(v[6])
    if isinstance(v[6], bool):
        available = v[6]
    elif v[6] is not None and not available_from:
        notes.append(f"Availability: {v[6]}")
    # Price: one number, or words for anything else
    price, price_text = None, None
    if isinstance(v[8], (int, float)):
        price = round(v[8])
    elif v[8] is not None:
        bare = re.sub(r"[₱,\s]", "", str(v[8]))
        price, price_text = (int(bare), None) if bare.isdigit() else (None, text(v[8], 500))
    pet = "yes" if v[15] is True else "no" if str(v[15]).strip().lower() == "no" else "unconfirmed"
    if isinstance(v[15], str) and v[15].strip().lower() not in ("no", "yes"):
        notes.append(f"Pets: {v[15].strip()}")
    rph = text(v[2], 100)
    return {
        "status": status,
        "type": text(v[4], 200),
        "location": text(v[7], 500),
        "price": price,
        "price_text": price_text,
        "price_note": text(v[9], 1000),
        "available": available,
        "available_from": available_from,
        "furnishing": text(v[10], 100),
        "specs": text(v[11], 4000),
        "inclusions": text(v[12], 4000),
        "payment_terms": text(v[13], 2000),
        "notes": "\n\n".join(n for n in notes if n) or None,
        "pet_friendly": pet,
        "summary": text(v[16], 4000),
        "source": text(v[0], 300),
        "source_url": url(c[0]),
        "fb_posted_on": day(v[1]),
        "fb_post_note": None if day(v[1]) else text(v[1], 300),
        "fb_post_url": url(c[1]),
        "rph_code": None if rph in (None, "False") else rph,
        "rph_url": url(c[2]),
        "fh_code": text(v[3], 100),
        "fh_url": url(c[3]),
        "rapa": flag(v[17]),
        "ats": flag(v[18]),
        "pictures": flag(v[19]),
    }


def main(path):
    ws = openpyxl.load_workbook(path, data_only=True)[SHEET]
    rows = [row_of(c) for c in ws.iter_rows(min_row=2, max_col=20) if any(x.value not in (None, "") for x in c)]
    rows = [r for r in rows if r["location"] or r["type"] or r["source"]]
    body = json.dumps(rows, ensure_ascii=False)
    assert "$inventory$" not in body
    cols = ", ".join(rows[0].keys())
    sys.stdout.reconfigure(encoding="utf-8")
    print(f"-- {len(rows)} properties from the {SHEET!r} sheet, {datetime.date.today()}")
    print(f"insert into inventory ({cols})\nselect {cols} from jsonb_populate_recordset(null::inventory, $inventory${body}$inventory$::jsonb);")


if __name__ == "__main__":
    main(sys.argv[1])
