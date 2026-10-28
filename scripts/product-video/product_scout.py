"""Scouts products for the ad test: for each search, lists Wikimedia Commons photos whose licence allows commercial
use (CC0, public domain, CC BY, CC BY-SA), with author and page, and writes a numbered contact sheet per product.
Usage: python product_scout.py out-dir "search one" "search two" ..."""
import argparse
import html
import json
import os
import re
import sys
import time
import traceback
import urllib.parse
import urllib.request

API = "https://commons.wikimedia.org/w/api.php"
HEADERS = {"User-Agent": "ViralFlowProductVideoTest/1.0 (https://github.com/kkhunmingg-commits/viralflow-ai) python-urllib"}
COMMERCIAL = re.compile(r"(?:CC0(?: 1\.0)?|Public domain|CC BY(?:-SA)? (?:1\.0|2\.0|2\.5|3\.0|4\.0))", re.I)


def commercial_candidate(row):
    """A discovery filter, never the owner's factual or rights approval."""
    return bool(COMMERCIAL.fullmatch(row.get("license", ""))) and not row.get("restrictions")


def product_image_candidate(row):
    # A live search returned a counterfeit watch first. Never promote that result.
    # Remaining photos still need an exact model/variant check, recorded as PENDING.
    title = row.get("title", "")
    return commercial_candidate(row) and not re.search(r"\b(counterfeit|replica|fake)\b", title, re.I)


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
        value = lambda key: html.unescape(re.sub("<[^>]+>", "", (meta.get(key) or {}).get("value", ""))).strip()
        rows.append({"title": page["title"], "page": info.get("descriptionurl"), "preview": info.get("thumburl"), "width": info.get("width"),
                     "height": info.get("height"), "mime": info.get("mime"), "license": value("LicenseShortName"), "licenseUrl": value("LicenseUrl"),
                     "creator": value("Artist"), "attributionRequired": value("AttributionRequired"),
                     "restrictions": value("Restrictions"), "rightsReview": "PENDING", "productIdentityReview": "PENDING"})
    return [r for r in rows if product_image_candidate(r) and (r["mime"] or "").startswith("image/")
            and (r["width"] or 0) >= 1000]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("out_dir")
    parser.add_argument("queries", nargs="+")
    parser.add_argument("--metadata-only", action="store_true", help="Search live sources without downloading images")
    parser.add_argument("--limit", type=int, default=6, help="Maximum candidate previews per query (1-30)")
    args = parser.parse_args()
    if not 1 <= args.limit <= 30:
        parser.error("--limit must be between 1 and 30")
    out = os.path.abspath(args.out_dir)
    if os.name == "nt" and os.path.splitdrive(out)[0].upper() != "D:":
        parser.error("Windows output must be on drive D")
    if not args.metadata_only:
        from PIL import Image, ImageDraw, ImageOps
    report = {}
    for query in args.queries:
        slug = re.sub("[^a-z0-9]+", "-", query.lower()).strip("-")
        os.makedirs(os.path.join(out, slug), exist_ok=True)
        try:
            rows = search(query)
        except Exception:
            report[query] = {"error": traceback.format_exc(limit=1)[-300:]}
            continue
        tiles = []
        for i, row in enumerate([] if args.metadata_only else rows[:args.limit]):
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
        if tiles:
            sheet = Image.new("RGB", (300 * 6, 300 * ((len(tiles) + 5) // 6)), "white")
            for i, tile in enumerate(tiles):
                sheet.paste(tile, ((i % 6) * 300, (i // 6) * 300))
            sheet.save(os.path.join(out, f"sheet-{slug}.jpg"), quality=85)
        report[query] = {"commercialLicenseCandidates": len(rows), "rightsReview": "PENDING", "files": rows[:args.limit]}
    with open(os.path.join(out, "scout.json"), "w", encoding="utf-8") as report_file:
        json.dump(report, report_file, ensure_ascii=False, indent=1)
    print(json.dumps({q: r.get("commercialLicenseCandidates", r.get("error")) for q, r in report.items()}))
    return 0 if any(r.get("files") for r in report.values()) else 1


if __name__ == "__main__":
    sys.exit(main())
