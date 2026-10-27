# Product-source scout restored from the existing backup

Restored `product_scout.py` from `origin/claude/real-product-video-test` at `0faece0`. No model, pre-rendered MP4 or media from that branch was merged. This remains a research command, not the Product Radar live catalog adapter or a completed Creative Brain job.

The command searches Wikimedia Commons' documented Imageinfo API and writes the source page, full creator credit, license URL, restrictions and **pending** identity/rights review. A matching license is only a discovery filter: exact product/variant, attribution, share-alike and other conditions still need review. A search result is not proof of authenticity, stock, sales, commission or a measured trend. Counterfeit/replica/fake titles are excluded; remaining titles are not automatically verified.

Use the existing Python interpreter with Pillow, under the drive-D environment:

```powershell
. .\scripts\enter-drive-d.ps1
# Replace python with the path to the existing interpreter when it is not on PATH.
python scripts/product-video/product_scout.py D:\ViralFlowAI\.runtime\real-product-discovery "Casio F-91W" --metadata-only --limit 4
python scripts/product-video/product_scout.py D:\ViralFlowAI\.runtime\real-product-pilot "Casio F-91W" --limit 2
python -m unittest discover -s scripts/product-video -p 'test_*.py'
```

On Windows output must resolve to D. Previews are bounded to 1–30 per query (default six); metadata-only does not download media. JSON reports use UTF-8. No matches or all failed searches produce a nonzero exit status. Reports/previews under `.runtime/` are ignored by Git and excluded from deployment uploads/traces. Never put signed URLs, credentials or browser sessions in this scout's inputs.

## Current real candidate, pending owner review

- Product: Casio F-91W, black standard model. [Current manufacturer page](https://www.casio.com/th/watches/casio/product.F-91W-1/) lists 21 g and MSRP THB 900. Do not label MSRP as an actual offer, assert stock, commission or endorse unverified seller claims.
- Selected reference: [front-closeup photograph by Multicherry](https://commons.wikimedia.org/wiki/File:Casio_F-91W_watch_(2023)_(front_closeup_-_time)_(minor_retouch).jpg), [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Preserve the author's credit and source/license references, identify modifications and review share-alike obligations before distributing any adaptation. This photo license does not grant Casio endorsement or trademark ownership.
- Actual live run: 48 candidate images, two previews downloaded on D. No hosted product, rights ledger approval, Creative Brain generation, Flow submission or imported master was created by this command.

Source API: [MediaWiki Imageinfo](https://www.mediawiki.org/wiki/API:Imageinfo). The model source and image license are separate evidence. Do not silently mark a discovered image `OWNER_CREATED` or mark owner review complete.
