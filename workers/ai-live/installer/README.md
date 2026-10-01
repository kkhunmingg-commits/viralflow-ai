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

Output: `installer/.dist/ViralFlow-Live-Agent-Setup-0.2.0.exe`. Build artifacts,
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

`SafeUpdater` verifies an Ed25519 signature using a pinned publisher key,
expiry, exact web/agent/worker versions, approved HTTPS host/path, package size,
SHA-256, and embedded version. States: `NOT_CONFIGURED`, `CURRENT`, `AVAILABLE`,
`UPDATING`, `RESTART_REQUIRED`, `ROLLED_BACK`. Applying requires explicit
confirmation and no active live session. No arbitrary URLs, shell commands, or
browser-supplied file paths are accepted. There is no production update server
or signing key configured; the offline signed-package path is tested only.

Customer registration/start remains blocked until the package has a trusted
server verification public key and the server entitlement/device registration
is configured. Developers can pass `--grant-public-key-file <public.pem>` when
building to bundle the trusted Ed25519 verification key at the fixed config
location. The build validates the key type and refuses private keys. A build
without this input remains unconfigured and registration/start fail closed.
Secrets must never be packaged. Large models, CUDA drivers, GPU inference dependencies, and actual
presenter benchmarking remain excluded.

The low-level updater requires an explicitly supplied delivery integration
callback that self-tests the runtime and updates the owned OS shortcut/registry.
Without that callback `applyReady=false` and apply is denied. The default
production channel is unconfigured: the foundation must not claim that an
unsigned arbitrary package can be activated automatically.

Official packaging reference: https://pyinstaller.org/en/stable/usage.html

## Local delivery evidence — 2026-10-01

Generated setup: `ViralFlow-Live-Agent-Setup-0.2.0.exe`, 54,003,280 bytes.
SHA-256: `4cedf8615fa6eb9805b52448155746ee17b92b3b9566cad765917c6567bd2681`.
Authenticode status: `NotSigned`. This is the local engineering artifact, not a
published customer release. A rebuild may produce a different binary hash.

The real extracted runtime passed its cryptography/public-agent exports and
Tk resource self-test. Fresh install, corrupted-file repair and uninstall ran
against the real bundle in isolated workspace directories. A hidden launch
with isolated `LOCALAPPDATA` executed the production launcher, created its
DPAPI identity, and returned unpaired, unauthorized discovery with version
`0.2.0`. Only that created process was stopped. No real desktop shortcut,
customer profile, cloud device, GPU inference or production setting was changed.
