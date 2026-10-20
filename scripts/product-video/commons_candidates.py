"""Lists Wikimedia Commons photos of a product with their licence, author and source page, and downloads
previews of the ones whose licence allows commercial use (CC0, public domain, CC BY, CC BY-SA).
Usage: python commons_candidates.py "Category:Casio F-91W" out-dir"""
import json
import os
import sys
import urllib.parse
import urllib.request

API = "https://commons.wikimedia.org/w/api.php"
HEADERS = {"User-Agent": "ViralFlowProductVideoTest/1.0 (research; contact via repository)"}
COMMERCIAL = ("cc0", "public domain", "pd", "cc by ", "cc-by-", "cc by-sa", "cc-by-sa")


def get(params):
    url = API + "?" + urllib.parse.urlencode(params)
    with urllib.request.urlopen(urllib.request.Request(url, headers=HEADERS), timeout=60) as response:
        return json.load(response)


def main() -> None:
    category, out = sys.argv[1], sys.argv[2]
    os.makedirs(os.path.join(out, "previews"), exist_ok=True)
    rows, cont = [], {}
    while True:
        data = get({"action": "query", "generator": "categorymembers", "gcmtitle": category, "gcmtype": "file", "gcmlimit": "100",
                    "prop": "imageinfo", "iiprop": "url|size|extmetadata|mime", "iiurlwidth": "1280", "format": "json", **cont})
        for page in (data.get("query", {}).get("pages", {}) or {}).values():
            info = (page.get("imageinfo") or [{}])[0]
            meta = info.get("extmetadata", {})
            value = lambda key: (meta.get(key) or {}).get("value", "")
            rows.append({"title": page["title"], "page": info.get("descriptionurl"), "original": info.get("url"),
                         "preview": info.get("thumburl"), "width": info.get("width"), "height": info.get("height"), "mime": info.get("mime"),
                         "license": value("LicenseShortName"), "licenseUrl": value("LicenseUrl"), "artist": value("Artist"),
                         "credit": value("Credit"), "attributionRequired": value("AttributionRequired"), "restrictions": value("Restrictions")})
        if "continue" not in data:
            break
        cont = data["continue"]
    for row in rows:
        row["commercialUse"] = row["license"].lower().startswith(COMMERCIAL) and not row["restrictions"]
    usable = [r for r in rows if r["commercialUse"] and (r["mime"] or "").startswith("image/") and r["preview"]]
    for index, row in enumerate(usable[:40]):
        name = f"{index:02d}.jpg"
        with urllib.request.urlopen(urllib.request.Request(row["preview"], headers=HEADERS), timeout=60) as response, \
                open(os.path.join(out, "previews", name), "wb") as file:
            file.write(response.read())
        row["previewFile"] = name
    json.dump({"category": category, "files": rows}, open(os.path.join(out, "candidates.json"), "w"), ensure_ascii=False, indent=2)
    print(json.dumps({"files": len(rows), "commercialUse": len(usable)}))


if __name__ == "__main__":
    main()
