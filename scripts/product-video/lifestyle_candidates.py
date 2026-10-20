"""Finds licensed photos of the product being worn (wrist, hand, desk, coffee) on Wikimedia Commons and Openverse,
keeps only licences that allow commercial use, and downloads previews plus a numbered contact sheet for review.
Usage: python lifestyle_candidates.py out-dir"""
import json
import os
import sys
import time
import traceback
import urllib.parse
import urllib.request

from PIL import Image, ImageDraw, ImageOps

HEADERS = {"User-Agent": "ViralFlowProductVideoTest/1.0 (https://github.com/kkhunmingg-commits/viralflow-ai) python-urllib"}
COMMONS = "https://commons.wikimedia.org/w/api.php"
OPENVERSE = "https://api.openverse.org/v1/images/"
COMMERCIAL = ("cc0", "public domain", "pd", "pdm", "cc by ", "cc-by-", "cc by-sa", "cc-by-sa", "by", "by-sa")
COMMONS_SEARCHES = ["F-91W wrist", "F91W wrist", "Casio F-91W worn", "Casio F91W hand", "Casio F-91W wearing", "Casio digital watch wrist"]
OPENVERSE_SEARCHES = ["casio f91w", "casio f-91w", "f91w wrist", "casio f91w wrist", "casio digital watch wrist"]


def fetch(url, binary=False):
    with urllib.request.urlopen(urllib.request.Request(url, headers=HEADERS), timeout=60) as response:
        return response.read() if binary else json.load(response)


def commons(rows, params):
    data = fetch(COMMONS + "?" + urllib.parse.urlencode({"action": "query", "prop": "imageinfo", "iiprop": "url|size|extmetadata|mime",
                                                         "iiurlwidth": "1280", "format": "json", **params}))
    for page in (data.get("query", {}).get("pages", {}) or {}).values():
        info = (page.get("imageinfo") or [{}])[0]
        meta = info.get("extmetadata", {})
        value = lambda key: (meta.get(key) or {}).get("value", "")
        rows.append({"source": "commons", "title": page["title"], "page": info.get("descriptionurl"), "preview": info.get("thumburl"),
                     "width": info.get("width"), "height": info.get("height"), "mime": info.get("mime"), "license": value("LicenseShortName"),
                     "licenseUrl": value("LicenseUrl"), "creator": value("Artist"), "restrictions": value("Restrictions")})


def main() -> None:
    out = sys.argv[1]
    os.makedirs(os.path.join(out, "previews"), exist_ok=True)
    rows, errors = [], []
    try:
        commons(rows, {"generator": "categorymembers", "gcmtitle": "Category:Casio F-91W", "gcmtype": "file", "gcmlimit": "200"})
    except Exception:
        errors.append(traceback.format_exc(limit=1)[-300:])
    for query in COMMONS_SEARCHES:
        try:
            commons(rows, {"generator": "search", "gsrsearch": query, "gsrnamespace": "6", "gsrlimit": "50"})
        except Exception:
            errors.append(traceback.format_exc(limit=1)[-300:])
    for query in OPENVERSE_SEARCHES:
        try:
            data = fetch(OPENVERSE + "?" + urllib.parse.urlencode({"q": query, "license_type": "commercial", "page_size": "40"}))
            for r in data.get("results", []):
                rows.append({"source": f"openverse/{r.get('source')}", "title": r.get("title"), "page": r.get("foreign_landing_url"),
                             "preview": r.get("url"), "width": r.get("width"), "height": r.get("height"), "mime": "image/" + (r.get("filetype") or "jpeg"),
                             "license": f"{r.get('license')} {r.get('license_version') or ''}".strip(), "licenseUrl": r.get("license_url"),
                             "creator": r.get("creator"), "restrictions": ""})
        except Exception:
            errors.append(traceback.format_exc(limit=1)[-300:])
        time.sleep(1)
    seen, unique = set(), []
    for row in rows:
        key = row.get("page") or row.get("preview")
        if key and key not in seen:
            seen.add(key)
            row["commercialUse"] = (row["license"] or "").lower().startswith(COMMERCIAL) and not row["restrictions"]
            unique.append(row)
    usable = [r for r in unique if r["commercialUse"] and (r["mime"] or "").startswith("image/") and r["preview"]]
    tiles = []
    for index, row in enumerate(usable[:120]):
        name = f"{index:02d}.jpg"
        for attempt in range(3):
            try:
                time.sleep(1.2 * (attempt + 1))
                open(os.path.join(out, "previews", name), "wb").write(fetch(row["preview"], binary=True))
                row["previewFile"] = name
                tile = ImageOps.pad(Image.open(os.path.join(out, "previews", name)).convert("RGB"), (300, 300), color="white")
                ImageDraw.Draw(tile).text((6, 4), str(index), fill="red")
                tiles.append(tile)
                break
            except Exception:
                row["previewError"] = traceback.format_exc(limit=1)[-300:]
    for page in range(0, len(tiles), 20):
        sheet = Image.new("RGB", (300 * 5, 300 * 4), "white")
        for i, tile in enumerate(tiles[page:page + 20]):
            sheet.paste(tile, ((i % 5) * 300, (i // 5) * 300))
        sheet.save(os.path.join(out, f"sheet-{page // 20}.jpg"), quality=85)
    json.dump({"files": unique, "errors": errors}, open(os.path.join(out, "candidates.json"), "w"), ensure_ascii=False, indent=2)
    print(json.dumps({"found": len(unique), "commercialUse": len(usable), "errors": len(errors)}))


if __name__ == "__main__":
    main()
