# Local Live Agent foundation

The installed Windows companion runs `launcher.pyw`, which shows a fresh one-time
pairing code in a small GUI and starts `AgentHTTPServer` on `127.0.0.1:8766`.
The trusted signed installer must package the Python runtime and
`requirements.txt`, then provision `config.json` beside the launcher with a
stable `deviceId` UUID and pinned `grantPublicKeyPem`. This repository does not
ship that installer or a working CUDA presenter/encoder. The shipped launcher
keeps `REALTIME_VALIDATED = False`; no browser value or environment variable
can turn on streaming.

The browser sends an exact allowed `Origin` and the agent requires an exact
`Host: 127.0.0.1:8766`. Browser routes are:

| Route | Authentication | Result |
| --- | --- | --- |
| `GET /v1/discovery` | Origin and Host | Minimal process/version detection |
| `POST /v1/pair` `{code}` | One-time GUI code | Origin-bound in-memory bearer, expiry, device ID |
| `POST /v1/renew` | Bearer | Rotated bearer and expiry; old bearer invalidated |
| `GET /v1/challenge` | Bearer | One-use 32-byte challenge |
| `GET /v1/status`, `GET /v1/hardware` | Bearer | Thai customer state only |
| `POST /v1/references` | Bearer | Bounded JPEG/PNG upload, returns opaque presenter ID |
| `POST /v1/sessions/start` | Bearer and cloud grant | Owner-bound local session, only after validation gate |
| `POST /v1/sessions/{id}/pause`, `/resume`, `/stop`, `/recover` | Owner-bound bearer | Session control; recovery is at most once and only while initial grant is fresh |

Cloud grants are Ed25519 signatures over recursively key-sorted compact JSON.
The signed fields are `v`, `ownerId`, `deviceId`, `challenge`, `accountId`,
`productIds`, `grantId`, `issuedAt`, `expiresAt`, `entitled`, and `versions`.
Start checks the signature, two-minute lifetime, one-use challenge and grant ID,
device, selected account/products, and exact web/agent/worker/model versions.
The initially unbound bearer becomes bound to the signed owner on first grant.
An established session may continue beyond grant expiry; membership changes
are checked at the next Start. Stop remains available to its owner regardless
of entitlement or hardware changes. There is no cloud or mock fallback.

`WorkerBoundary` is the trusted local Python worker adapter. The default
`UnavailableWorker` refuses Start. `MuseTalkLocalPresenter` is an alias of the
existing `PresenterProvider` implementation in `../presenter.py`, which itself
requires a genuine incremental local backend. `LocalEncoder` is a refusing
boundary until its output has been validated. Raw audio/video is never sent to
ViralFlow Cloud by this package.

`BootstrapManager` is an installer plan, not a downloader. The installer passes
its pinned Ed25519 key and exact allowlisted download hosts, then calls
`load_manifest({payload,signature})`. Only signed, fixed artifact names and
HTTPS paths under `/viralflow/ai-live/` are accepted. Trusted installer code
may call `stage_verified_bytes`, which verifies size and SHA-256 before writing
fixed local filenames. `status`, `repair_needed`, `check_updates`, and
`uninstall_cleanup` provide first-run, dependency/model, update, repair, and
cleanup state. Large model transfer, actual downloads, executable installation,
and automatic update scheduling remain to be built and verified on NVIDIA.

`hardware.py` records technical diagnostics only through the trusted
`developer_diagnostics` method. Browser routes receive Thai reasons with no
GPU model, driver, encoder, worker port, file path, or internal provider name.
VRAM/RAM/disk tiers are provisional and carry `GPU_VALIDATION_REQUIRED` until
real NVIDIA benchmarks and the full acceptance checklist pass.
