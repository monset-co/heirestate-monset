"""Positions for the inventory, from OpenStreetMap's free geocoder (Nominatim), as SQL.

    python scripts/inventory_geocode.py "Property Listings Library.xlsx" > inventory-geo.sql

then paste the file into Supabase > SQL editor and run it. Each location is looked up once, one
request a second (Nominatim's rule), and remembered in geocode-cache.json so a second run asks
nothing it has asked before. A location it can't place exactly falls back to its neighbourhood
and is marked 'approx'; drag its pin in the admin to fix it. `--landmarks` prints the landmarks'
positions instead (for admin/src/places.js).

Needs openpyxl. Sends only the location text, never names or numbers.
"""
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

import openpyxl

CACHE = Path("geocode-cache.json")
UA = "realestate-inventory-geocoder/1.0 (one-off batch, 1 request a second)"
# Metro Cebu: left, top, right, bottom
VIEWBOX = "123.55,10.55,124.15,10.05"
LANDMARKS = [
    "Cebu IT Park", "Ayala Center Cebu", "SM City Cebu", "SM Seaside City Cebu", "Cebu Business Park",
    "Fuente Osmeña Circle", "Cebu Doctors' University Hospital", "Chong Hua Hospital", "Perpetual Succour Hospital Cebu",
    "University of San Carlos Talamban Campus", "University of Cebu Banilad", "Cebu International School",
    "Mactan-Cebu International Airport", "Robinsons Galleria Cebu", "Il Corso SRP Cebu", "Cebu Provincial Capitol",
]

cache = json.loads(CACHE.read_text(encoding="utf-8")) if CACHE.exists() else {}
last = [0.0]


def search(q):
    if q in cache:
        return cache[q]
    wait = 1.1 - (time.time() - last[0])
    if wait > 0:
        time.sleep(wait)
    url = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode(
        {"q": q, "format": "jsonv2", "countrycodes": "ph", "viewbox": VIEWBOX, "bounded": 1, "limit": 1})
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "en"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            hits = json.load(r)
    except Exception as e:  # a hiccup: skip it this run, it's asked again next time
        print(f"-- skipped {q!r}: {e}", file=sys.stderr)
        last[0] = time.time()
        return None
    last[0] = time.time()
    hit = hits[0] if hits else None
    cache[q] = hit and {"lat": float(hit["lat"]), "lng": float(hit["lon"]), "rank": int(hit.get("place_rank", 0)), "name": hit.get("display_name", "")[:120]}
    CACHE.write_text(json.dumps(cache, ensure_ascii=False, indent=0), encoding="utf-8")
    return cache[q]


NOISE = re.compile(r"\([^)]*\)|\b(tower|bldg\.?|building|unit|phase|block|lot|blk)\s*[\w-]*|\b\d+(st|nd|rd|th)\s*(floor|flr)\b|\bground floor\b|\b\d{4}\b(?=\s*cebu)", re.I)


# the condominiums the admin knows (admin/src/match.js), by a word their location always has
BUILDINGS = {
    "38 park": "38 Park Avenue", "riala": "Avida Towers Riala", "avida towers cebu": "Avida Towers Cebu", "solinea": "Solinea Tower",
    "mivesa": "Mivesa Garden Residences", "mivela": "Mivela Garden Residences", "marco polo": "Marco Polo Residences",
    "city suites": "City Suites Ramos Tower", "jones": "West Jones Residences", "alcoves": "The Alcoves", "taft east": "Taft East Gate",
    "east aurora": "East Aurora", "the median": "The Median", "city clou": "City Clou", "avalon": "Avalon Condominium",
    "32 sanson": "32 Sanson by Rockwell", "horizon 101": "Horizon 101", "mabolo garden": "Mabolo Garden Flats", "amalfi": "Amalfi Oasis",
    "le menda": "Le Menda Residences", "sunvida": "Sunvida Tower", "club ultima": "Club Ultima", "ultima residences": "Ultima Residences",
    "vertex central": "Vertex Central", "baseline": "Baseline Residences", "base line": "Baseline Residences", "arc towers": "ARC Towers",
    "symfoni": "Symfoni Nichols", "botanika": "Botanika Garden Residences", "one oasis": "One Oasis Cebu", "padgett": "The Padgett Place",
    "parkpoint": "Parkpoint Residences", "park point": "Parkpoint Residences", "san remo": "San Remo Oasis",
}


CITIES = {"cebu city": "Cebu City", "mandaue": "Mandaue", "lapu": "Lapu-Lapu", "mactan": "Lapu-Lapu", "talisay": "Talisay",
          "minglanilla": "Minglanilla", "consolacion": "Consolacion", "liloan": "Liloan", "naga": "Naga", "cordova": "Cordova"}


def same_city(location, hit):
    """A hit in another town is a wrong hit (a "Horizon 101" in Talisay for one on Mango Avenue):
    when the location names its city, the answer must be in it."""
    low = location.lower()
    city = next((c for w, c in CITIES.items() if w in low), None)
    return city is None or city.lower() in hit["name"].lower()


def place(location):
    """A known condominium by its name first; else the whole location, then drop its first part at
    a time ("Tower 3, Marco Polo…, Lahug" → "Marco Polo…, Lahug" → …). A building or street is
    exact; a neighbourhood or a city is approx."""
    low = location.lower()
    for word, name in BUILDINGS.items():
        if word in low:
            hit = search(f"{name}, Cebu")
            if hit and hit["rank"] >= 26 and same_city(location, hit):
                return hit, "exact"
            break
    clean = NOISE.sub("", location.replace("\n", ", "))
    parts = [p.strip(" .-") for p in clean.split(",") if p.strip(" .-")]
    for i in range(min(len(parts), 4)):
        q = ", ".join(parts[i:])
        if len(q) < 4:
            break
        hit = search(q if re.search(r"cebu|mandaue|lapu|talisay|minglanilla|consolacion|liloan|naga|cordova", q, re.I) else q + ", Cebu")
        if hit and same_city(location, hit):
            return hit, "exact" if hit["rank"] >= 26 else "approx"
    return None, None


def sql(s):
    return "'" + s.replace("'", "''") + "'"


def main():
    if "--landmarks" in sys.argv:
        out = {n: (lambda h: h and [round(h["lat"], 5), round(h["lng"], 5)])(search(n)) for n in LANDMARKS}
        print(json.dumps(out, ensure_ascii=False, indent=1))
        return
    ws = openpyxl.load_workbook(sys.argv[1], data_only=True)["RPL FB Account"]
    locations = sorted({str(r[7]).strip() for r in ws.iter_rows(min_row=2, values_only=True) if r[7] and str(r[7]).strip()})
    found = 0
    sys.stdout.reconfigure(encoding="utf-8")
    print(f"-- positions for {len(locations)} locations, from OpenStreetMap")
    for loc in locations:
        hit, geo = place(loc)
        if not hit:
            print(f"-- not found: {loc[:80]}", file=sys.stderr)
            continue
        found += 1
        # only where no one has placed it yet: a pin dropped by hand is never overwritten
        print(f"update inventory set lat = {hit['lat']:.6f}, lng = {hit['lng']:.6f}, geo = '{geo}' where location = {sql(loc)} and geo is distinct from 'pinned';")
    print(f"-- {found} of {len(locations)} placed", file=sys.stderr)


if __name__ == "__main__":
    main()
