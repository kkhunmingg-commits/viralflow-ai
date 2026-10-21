"""Scouts products for the ad test: for each search, lists Wikimedia Commons photos whose licence allows commercial
use (CC0, public domain, CC BY, CC BY-SA), with author and page, and writes a numbered contact sheet per product.
Usage: python product_scout.py out-dir "search one" "search two" ..."""
import json
import os
import re
import sys
import time
import traceback
import urllib.parse
import urllib.request

from PIL import Image, ImageDraw, ImageOps

API = "https://commons.wikimedia.org/w/api.php"
HEADERS = {"User-Agent": "ViralFlowProductVideoTest/1.0 (https://github.com/kkhunmingg-commits/viralflow-ai) python-urllib"}
COMMERCIAL = ("cc0", "public domain", "pd", "cc by ", "cc-by-", "cc by-sa", "cc-by-sa")


def fetch(url, binary=False):
    with urllib.request.urlopen(urllib.request.Request(url, headers=HEADERS), timeout=60) as response:
        return response.read() if binary else json.load(response)


def search(query):
    data = fetch(API + "?" + urllib.parse.urlencode({"action": "query", "generator": "search", "gsrsearch": query, "gsrnamespace": "6",
                                                     "gsrlimit": "50", "prop": "imageinfo", "iiprop": "url|size|extmetadata|mime",
                                                     "iiurlwidth": "640", "format": "json"}))
    rows = []
    for page in sorted((data.get("query", {}).get("pages", {}) or {}).values(), key=lambda p: p.get("index", 0)):
        info = (page.get("imageinfo") or [{}])[0]
        meta = info.get("extmetadata", {})
        value = lambda key: re.sub("<[^>]+>", "", (meta.get(key) or {}).get("value", "")).strip()
        rows.append({"title": page["title"], "page": info.get("descriptionurl"), "preview": info.get("thumburl"), "width": info.get("width"),
                     "height": info.get("height"), "mime": info.get("mime"), "license": value("LicenseShortName"), "creator": value("Artist")[:80],
                     "restrictions": value("Restrictions")})
    return [r for r in rows if r["license"].lower().startswith(COMMERCIAL) and not r["restrictions"] and (r["mime"] or "").startswith("image/")
            and (r["width"] or 0) >= 1000]


def main() -> None:
    out = sys.argv[1]
    report = {}
    for n, query in enumerate(sys.argv[2:]):
        slug = re.sub("[^a-z0-9]+", "-", query.lower()).strip("-")
        os.makedirs(os.path.join(out, slug), exist_ok=True)
        try:
            rows = search(query)
        except Exception:
            report[query] = {"error": traceback.format_exc(limit=1)[-300:]}
            continue
        tiles = []
        for i, row in enumerate(rows[:30]):
            for attempt in range(3):
                try:
                    time.sleep(1.0 * (attempt + 1))
                    path = os.path.join(out, slug, f"{i:02d}.jpg")
                    open(path, "wb").write(fetch(row["preview"], binary=True))
                    row["previewFile"] = f"{slug}/{i:02d}.jpg"
                    tile = ImageOps.pad(Image.open(path).convert("RGB"), (300, 300), color="white")
                    ImageDraw.Draw(tile).text((6, 4), str(i), fill="red")
                    tiles.append(tile)
                    break
                except Exception:
                    row["previewError"] = traceback.format_exc(limit=1)[-200:]
        sheet = Image.new("RGB", (300 * 6, 300 * max(1, (len(tiles) + 5) // 6)), "white")
        for i, tile in enumerate(tiles):
            sheet.paste(tile, ((i % 6) * 300, (i // 6) * 300))
        sheet.save(os.path.join(out, f"sheet-{slug}.jpg"), quality=85)
        report[query] = {"commercialUse": len(rows), "files": rows[:30]}
    json.dump(report, open(os.path.join(out, "scout.json"), "w"), ensure_ascii=False, indent=1)
    print(json.dumps({q: r.get("commercialUse", r.get("error")) for q, r in report.items()}))


if __name__ == "__main__":
    main()
