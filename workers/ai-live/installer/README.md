# Windows Local Live Agent delivery

`build_windows.py` creates a self-contained **windowed** setup executable and an
agent runtime. Customers double-click setup, choose Install/Update or Repair,
and open the desktop shortcut. No manual Python installation or terminal is
required. The maintenance application also appears in Windows installed apps
for repair/uninstall. Install scope is the current Windows user only.

Build (developer only, Windows):

```powershell
python -m venv workers/ai-live/installer/.venv
workers/ai-live/installer/.venv/Scripts/python.exe -m pip install -r workers/ai-live/installer/requirements-build.txt
workers/ai-live/installer/.venv/Scripts/python.exe workers/ai-live/installer/build_windows.py
```

Output: `installer/.dist/ViralFlow-Live-Agent-Setup-0.3.0.exe`. Build artifacts,
the isolated build environment, and extracted test installations are ignored by
Git. This engineering setup is **unsigned**, not published, not an approved
production installer, and not proof that live presentation works.

## Installed layout

```text
%LOCALAPPDATA%/ViralFlow/LiveAgent/
  managed.json              # ownership marker; unknown folders are never removed
  current.json              # atomic selected-release record and file hashes
  maintenance.exe           # install/repair/uninstall GUI
  releases/<version>-<nonce>/
    LocalLiveAgent.exe       # bundled Python/Tk/cryptography, no manual setup
    _internal/
    ffmpeg.exe + LICENSE + README
  identity/device.bin       # first-run identity protected by Windows DPAPI
  references/               # selected local presenter reference files
  updates/                  # reserved for trusted signed update packages
```

Fresh install verifies the embedded ZIP checksum, every file checksum, size
limits, Windows filename rules, and path containment. Repair installs a clean
release instead of patching the running one. Upgrade rejects downgrades, stages
a new release, runs the packaged dependency self-test, updates fixed current-user
OS integration, then replaces `current.json` atomically. Failed installation
retains the old pointer/runtime and attempts to restore its OS integration.
Running sessions must stop before a signed update is applied.
The offline setup refuses modifications while the local companion endpoint is
open and asks the customer to stop/close it first.

Uninstall confirms with the customer, removes only the exact managed registry
key/shortcut and known local data directories, including encrypted device
identity. Unknown files remain. It does not delete any ViralFlow account,
TikTok connection, cloud analytics, or subscription. A running maintenance EXE
relays to a temporary self-copy so Windows can release the installed binary;
the temporary uninstaller file is left for OS temp cleanup.

## Update foundation

`SafeUpdater` verifies a v2 Ed25519 envelope `{payload,signature,keyId}` using
installed active public keys. The signature covers both `keyId` and `payload`.
The release plan includes issuance/expiry, lockstep web/agent/worker versions,
minimum versions, mandatory status, previous fallback version, and the immutable
package URL/size/SHA-256. Retired or unknown keys fail closed. Legacy v1 envelopes
remain offline-only and cannot bypass a configured key retirement policy.

The authenticated web app obtains `/api/ai-live/updates/manifest` after a fresh
server entitlement check, then sends that signed public plan through the paired
`POST /v1/updates/check` endpoint. It never supplies cookies, cloud credentials,
public trust roots, arbitrary commands, or local paths to the agent. The package
must match the installed `updateOrigin` and exact path
`/viralflow/ai-live/releases/<version>/package.zip` with no query/fragment/port
overrides. Delivery resolves only public IPs, pins the validated address, checks
TLS certificates/hostname, ignores proxy configuration, denies redirects,
enforces timeouts and bounded bytes, and verifies SHA-256 before staging.

Confirmed `POST /v1/updates/apply` and `/v1/updates/repair` run the real download,
runtime self-test, fixed OS integration, and atomic activation transaction in a
bounded background operation. Status polling reports `UPDATING`,
`RESTART_REQUIRED`, or `ROLLED_BACK`; duplicate activation and active sessions
are blocked. Repair requires a signature-verified package for the installed
version. Cached public plans are reverified under the current installed key ring
and expiry before use. A failed install retains the old pointer and restores
its integration. `rollbackVersion` describes the previous fallback; it does not
authorize downloading or installing an older version. Downgrades remain denied.
States also include `NOT_CONFIGURED`, `CURRENT`, `AVAILABLE`, `UPDATE_REQUIRED`.
Minimum-version/mandatory updates block Start until installation/restart.

This pipeline is tested through the real local HTTP/transport/installer path,
isolating the network and OS boundaries only. No production release storage,
update origin, signing private key or Authenticode certificate is configured
by this work. The engineering package remains unconfigured and fail-closed for
registration/start. Public release signatures authorize software integrity,
never membership or permission to run LIVE.

Customer registration/start remains blocked until the package has a trusted
server verification public key and the server entitlement/device registration
is configured. Developers can pass `--grant-public-key-file <public.pem>` when
building to bundle the trusted Ed25519 verification key at the fixed config
location. The build validates the key type and refuses private keys. A build
without this input remains unconfigured and registration/start fail closed.
The current release also supports `--public-config <public.json>` with only
`trustedKeys` (key ID to Ed25519 public PEM), `retiredKeyIds`, optional legacy
`grantPublicKeyPem`, and optional fixed HTTPS `updateOrigin`. The build validates
every key and rejects private keys or extra fields. Never populate trust roots
from a browser request. Version 0.2.0 predates these distribution endpoints;
users of that version require the new offline setup before web-driven updates.
Secrets must never be packaged. Large models, CUDA drivers, GPU inference dependencies, and actual
presenter benchmarking remain excluded.

The low-level updater requires an explicitly supplied delivery integration
callback that self-tests the runtime and updates the owned OS shortcut/registry.
Without that callback `applyReady=false` and apply is denied. The default
production channel is unconfigured: the foundation must not claim that an
unsigned arbitrary package can be activated automatically.

Official packaging reference: https://pyinstaller.org/en/stable/usage.html

## Local delivery evidence — 2026-10-02

Generated setup: `ViralFlow-Live-Agent-Setup-0.3.0.exe`, 56,278,774 bytes.
SHA-256: `d6b3168c7025d6f81ef903fe95a4917be7253ac312ca81bcd9f14ab36a1adda5`.
Immutable package input: `installer/.build/payload.zip`, 46,886,504 bytes.
SHA-256: `4255420400c6485f0e058d77fbd9082a8c2b1d24408c3c0ae7b02678ba60ef3b`.
This package ZIP, rather than the GUI setup EXE, is the update manifest's target
when a publisher prepares a real signed release channel. It is not uploaded or
published by this work, and both artifacts remain ignored by Git.
Authenticode status: `NotSigned`. This is the local engineering artifact, not a
published customer release. A rebuild may produce a different binary hash.

The real extracted runtime passed its cryptography/public-agent exports,
Tk resources, native PortAudio, internal media/stream worker imports, and
H.264/AAC capability self-test. It verifies that `REALTIME_VALIDATED` remains
false. Managed sounddevice/PortAudio files and their notices are bundled; no
manual Python setup, virtual audio driver or external broadcaster is required.
Windows long-path normalization is applied only to the packaged PortAudio DLL
path so the native loader works even in deep isolated installation directories.
Self-test failures return a nonzero exit code instead of an invisible windowed
exception dialog. Fresh install, corrupted-file repair and uninstall ran
against the real bundle in isolated workspace directories. A hidden launch
with isolated `LOCALAPPDATA` executed the production launcher, created its
DPAPI identity, and returned unpaired, unauthorized discovery with version
`0.3.0`, update channel unconfigured, and update/repair unavailable. Only that
created process was stopped. No real desktop shortcut,
customer profile, cloud device, GPU inference or production setting was changed.
