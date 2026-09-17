# Originality Gate V1

`originality-gate-v1` checks repeat risk before any future publish operation. It compares structured metadata first, so Phase 6C needs no paid model and does not inspect private media with an external provider.

## Similarity model

For each historical video, the engine calculates token similarity for hook, scenes, CTA, and audio metadata and adds a small lineage signal:

```text
PairSimilarity = min(1,
  0.30 × HookSimilarity +
  0.30 × SceneSimilarity +
  0.15 × AudioSimilarity +
  0.05 × CTASimilarity +
  0.20 when master matches +
  0.05 when product matches +
  0.05 when creative project matches
)
```

The engine reports the maximum same-account score, maximum cross-account score, overall maximum, component scores from the closest match, and matched video IDs. Cross-account matching only compares another account owned by the same ViralFlow owner; RLS prevents visibility into other owners.

| Overall similarity | Status | Gate behavior |
|---:|---|---|
| `< 0.58` | `ORIGINAL` | May proceed |
| `0.58–0.8199` | `ACCEPTABLE_VARIATION` | May proceed with recorded evidence |
| `0.82–0.9499` | `TOO_SIMILAR` | Regenerate |
| `≥ 0.95` | `REJECT` | Reject exact/near-exact duplicate |

These thresholds are deliberately stricter than the Phase 6 variation-construction threshold. Changing a crop alone cannot erase identical hook, scene, CTA, audio, product, and creative lineage signals.

## Cross-account and spam rules

- The same master/product/creative combination on another owned account increases similarity.
- Repeated hook, scene, CTA, and audio structure is measured even when IDs differ.
- `TOO_SIMILAR` never advances by consuming unused account capacity.
- `REJECT` never becomes publishable through manual cap changes.
- Queuing preserves the gate result and cannot bypass originality on the next day.
- Account-level generation and publishing are separate, preventing a large generated set from becoming a same-day spam burst.

## Deterministic fixtures

| Fixture | Scenario | Expected |
|---|---|---|
| A | Identical content | `REJECT` |
| B | Same master with only a different hook | `TOO_SIMILAR` |
| C | Same product with a different hook, scene, and CTA | `ACCEPTABLE_VARIATION` |
| D | Near-identical content on another owned account | `TOO_SIMILAR` or stricter |
| E | Different product, creative intent, scene, CTA, and audio | `ORIGINAL` |

The 10-account simulation creates 200 candidates (20 per account). With alternating effective caps of 10 and 8, only 90 become `READY_FOR_REVIEW`; 110 are `QUEUE_NEXT_DAY`. Duplicates and failed gates reduce the ready set further and never increase capacity.
