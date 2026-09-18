# Stage B benchmark assets

The three source images were created on 18 September 2026 with the Codex built-in image-generation capability. They are original synthetic product packshots, use fictional VF test labels, have no stock-image dependency, and are not based on a real brand or trademark. The generated PNG outputs were converted locally to JPEG with the repository's bundled FFmpeg binary.

| Fixture | Ignored local path | Product identity anchors | Dimensions |
|---|---|---|---:|
| Beauty | benchmark-assets/beauty.jpg | Ivory/coral pump bottle, removable cap, silver band, VF LAB, SERUM B-01, 30 mL | 1254 × 1254 |
| Home | benchmark-assets/home.jpg | Sage/white trigger bottle, linkage, curved neck, ribbed grip, measuring window, VF HOME, CLEAN H-02, 500 mL | 1254 × 1254 |
| Gadget | benchmark-assets/gadget.jpg | Charcoal/blue timer, 08:00 display, three buttons, dial, grille, USB-C port, VF TECH, G-03 | 1254 × 1254 |

The binary assets stay outside Git through benchmark-assets/. The tracked manifest is benchmarks/stage-b-veo-lite.json.

## Flow reference boundary

benchmark-assets/flow-baseline.mp4 is owner-supplied and must never be fabricated.

Current preparation state: FLOW_REFERENCE_STATUS=OWNER_REQUIRED.

Without that file, Stage B may run the technical benchmark and automated quality evaluation. It must not assign FLOW_COMPARABLE or ABOVE_FLOW, run a second sample, or select a production provider. The benchmark rubric and tests already enforce this boundary.

## Intended Stage B scope

- Candidate: veo_3_1_lite
- Fixtures: Beauty, Home, Gadget
- Repeats: 1
- Maximum paid attempts: 3
- Planned maximum at the repository's current estimate: US$1.20
- No automatic paid retry
- No fal, PixVerse, Runway, Meta, or TikTok Symphony execution

The asset-preparation change does not execute the provider. A future paid run still requires the server-only Google key, a fresh official-price check, the explicit paid flag, the hard budget cap, and owner authorization.
