# Archived local helper source — WIP, not integrated

These 25 small project-authored helper files plus two dependency manifests previously existed only inside ignored
development/benchmark directories. Their exact bytes are preserved as `.source`
files so TypeScript/ESLint/build discovery cannot execute or integrate them.
`INDEX.json` records each original relative path, archive path, byte size and SHA-256.
No model, executable, generated video, screenshot, environment file or session is
included here. Compiled bundles and upstream third-party documentation are excluded.

## Restore safely

Choose the matching source branch first: `feature/ai-live` for AI LIVE helpers,
`feature/post-multi-account` for old POST proof helpers, and
`codex/google-vids-fal-router` for economy benchmark scripts. Copy only the selected
`.source` bytes to the `OriginalPath` recorded in the index, without the `.source`
suffix. Refuse to overwrite any existing destination; compare SHA-256 first.
Original import paths/workspace assumptions may need review after restoration.

These helpers have **not** been rerun as part of the handoff. UI fixtures and SQL
fixtures are synthetic and are not evidence of real customer performance. Counts
inside fixtures are examples, never architecture account/post limits.

## Execution warnings

- Economy benchmark helpers can submit paid generation when explicitly run. Old
  authorization IDs/budgets in archived source do not authorize a new request.
  Do not run them without a new owner-approved budget and reviewed current guards.
- Model preparation helpers can download large artifacts. Recheck provenance,
  hashes, license and destination before running; no downloads were performed here.
- Local probing helpers are historical development tools, not customer-facing
  services or production credentials/configuration.
- Archived source does not restore the associated local model/media/state. Those
  remain separately inventoried and `PENDING BACKUP`.
