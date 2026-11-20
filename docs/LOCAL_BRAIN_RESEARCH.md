# Local Brain selection and CPU evidence

Checked 2026-10-06 against official Qwen repositories and the actual pinned
llama.cpp release. The default is **Qwen3-4B GGUF Q4_K_M**, running locally in
non-thinking mode. Qwen3-8B is optional and never downloaded or selected by
default. No customer AI key, Hugging Face token or external AI call is needed.

## Official sources and license admission

| Artifact | Official evidence | License / admission |
| --- | --- | --- |
| Qwen3-4B GGUF | [model card](https://huggingface.co/Qwen/Qwen3-4B-GGUF), [pinned license](https://huggingface.co/Qwen/Qwen3-4B-GGUF/blob/bc640142c66e1fdd12af0bd68f40445458f3869b/LICENSE) | Apache-2.0; commercial use and redistribution permitted subject to its notices and conditions |
| Qwen3-8B GGUF | [model card](https://huggingface.co/Qwen/Qwen3-8B-GGUF), [pinned license](https://huggingface.co/Qwen/Qwen3-8B-GGUF/blob/7c41481f57cb95916b40956ab2f0b139b296d974/LICENSE) | Apache-2.0; optional, resource admission required |
| llama.cpp | [b11438 release](https://github.com/ggml-org/llama.cpp/releases/tag/b11438), [pinned LICENSE](https://github.com/ggml-org/llama.cpp/blob/b11438/LICENSE), [pinned server guide](https://github.com/ggml-org/llama.cpp/blob/b11438/tools/server/README.md) | MIT; retain copyright/license notice |
| Windows CPU release OpenMP library | `LICENSE-LLVM-OpenMP` contained in the verified official archive | Apache-2.0 with LLVM exceptions; preserve this complete notice when packaging |

The installer must include the model license, llama.cpp copyright/license and
bundled dependency notices in its signed release, together with every DLL needed
by the runtime. An executable hash alone does not admit unsigned DLLs.
`workers/ai-live/local-brain-candidates.json` is machine-readable publisher
planning with `release_state: "NOT_SIGNED_RELEASE"` and
`automatic_download: false`; it cannot authorize customer installation.

Qwen's [local llama.cpp guide](https://qwen.readthedocs.io/en/latest/run_locally/llama.cpp.html)
describes Qwen3's soft `/no_think` switch. The pinned llama.cpp API supports
`reasoning_effort: "none"` per request. The actual b11438 executable warns that
setting `enable_thinking` through the **server command line** is deprecated;
the implementation uses `--reasoning off` and `--no-ui`. Per-request
`chat_template_kwargs: {"enable_thinking": false}` remains documented in the
pinned server API. A 96-token output bound, 2,048-token context and deadline
replace research-scale long generation settings. Unexpected reasoning output
is rejected before speech.

## Reproducible pins

| Artifact | Version / revision | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| `Qwen3-4B-Q4_K_M.gguf` | `bc640142c66e1fdd12af0bd68f40445458f3869b` | 2,497,280,256 | `7485fe6f11af29433bc51cab58009521f205840f5b4ae3a32fa7f92e8534fdf5` |
| `Qwen3-8B-Q4_K_M.gguf` | `7c41481f57cb95916b40956ab2f0b139b296d974` | 5,027,783,488 | `d98cdcbd03e17ce47681435b5150e34c1417f50b5c0019dd560e4882c5745785` |
| `llama-b11438-bin-win-cpu-x64.zip` | b11438 / `cbb7d52ec` | 19,399,367 | `8f9350b0082d1b9052992991456206070e817bfa63cd8d49e7b3bad304306c9e` |
| extracted `llama-server.exe` | b11438 / `cbb7d52ec` | 9,216 | `fdce526b3a5f9de9f7c85c5efdd97ee00b8800183d373efe3a18c72e8fddf58d` |

GGUF hashes and sizes came from the official Hugging Face model API's LFS
metadata. The archive digest came from the official GitHub release API. The 4B
GGUF and runtime ZIP were downloaded publicly without a token, and their hashes
were checked against those independent metadata values before execution. The
8B pin was researched; the 8B model was not downloaded or benchmarked.

Official download locations:

- [4B pinned GGUF](https://huggingface.co/Qwen/Qwen3-4B-GGUF/resolve/bc640142c66e1fdd12af0bd68f40445458f3869b/Qwen3-4B-Q4_K_M.gguf)
- [8B pinned GGUF](https://huggingface.co/Qwen/Qwen3-8B-GGUF/resolve/7c41481f57cb95916b40956ab2f0b139b296d974/Qwen3-8B-Q4_K_M.gguf)
- [Windows CPU runtime archive](https://github.com/ggml-org/llama.cpp/releases/download/b11438/llama-b11438-bin-win-cpu-x64.zip)

## Production grounding and isolation

`BrainScope(owner_id, account_id, room_id)` must use the verified account grant
and current session ID. The trusted product sync populates
`ProductSnapshot(scope, product_id, name, version, facts)`. Comments cannot
supply or overwrite snapshots. `InMemoryProductStore` copies snapshots on both
insertion and retrieval, and keys each product by its complete scope.

Price, stock, size/color, shipping, promotion, purchase instructions, approved
FAQ and product attributes use deterministic source templates. Missing facts
produce “ยังไม่พบข้อมูลนี้ในข้อมูลสินค้าของร้านค่ะ”. Attribute/FAQ answers
require approved question aliases from the snapshot; they are not inferred
from other attributes. Price accepts a finite non-negative number in THB;
missing/invalid price or a foreign currency is not guessed.

Only general conversation enters the LLM. Product facts, owner/account IDs and
credentials are excluded from that prompt. Its output must equal one approved
non-factual Thai phrase, otherwise a safe greeting/thank-you template is used.
This intentionally limits open-ended conversation: a keyword filter or a
“do not hallucinate” prompt cannot prove that a novel product claim is true.

Cache keys hash the owner, account, room, product ID, version, full facts,
normalized comment and policy revision. A fact change invalidates the cache
even when a server version is accidentally unchanged. The cache has a bounded
entry count and TTL; clearing a scope never clears another room. llama.cpp's
prompt-cache reuse is disabled per request, and no conversation history is
carried between rooms.

## Runtime and factory contract

`make_managed_local_brain(components, product_store, resource_manager=None)`
resolves the signed `qwen3-4b-q4_k_m` BRAIN and `llama-cpp-cpu` RUNTIME catalog
records. It accepts exactly one allowed GGUF and llama-server executable from
the same installed release. No browser model path, command, external endpoint
or customer key is accepted. Scheduling/resource admission belongs to the
existing LIVE scheduler. The default has zero GPU layers.

`ManagedLlamaRuntime` verifies hashes before launch; rejects path escapes,
symlinks and junctions; starts a fixed argument list without a shell; strips
inherited provider keys, proxies and llama environment flags; binds only
`127.0.0.1`; and uses a freshly generated private token file. It disables UI
and slot diagnostics. The local client uses a literal loopback IP and direct
HTTP without DNS, proxy or redirect support. Request/response byte limits,
single generation admission, cancellation and timeout prevent unbounded work.
Disconnecting a cancelled response stops that request; a stuck reader causes
the managed process to be stopped. Shutdown removes the token file.

Mutable authentication state lives in `managed-application/local-ai-state`,
outside `components/releases/<version>-<identity>`. Its Windows DACL permits
only the current user and SYSTEM; Unix permissions are 0700/0600. A fixed
user-scoped Windows named mutex serializes actual model loading across room
child processes, with a bounded wait. Linux uses an advisory lock file in the
private owned state directory. The factory and the locked launch both require
8 GiB total and 5 GiB currently available physical RAM. The explicit CPU DEV
proof bypasses that installer admission threshold and never claims customer
readiness. The OS uninstaller removes only recognized authentication/lock files
in a marked state directory after worker shutdown; repair never clears it.

`health().ready` stays false until a real warmup completion passes.
`PendingLocalBrainRuntime` reports `LOCAL_BRAIN_MODEL_PENDING` for installations
without a signed model. Error codes include `LOCAL_BRAIN_TIMEOUT`,
`LOCAL_BRAIN_CANCELLED`, `LOCAL_BRAIN_HASH_MISMATCH` and
`LOCAL_BRAIN_PRODUCT_SCOPE_MISMATCH`; the scheduler uses its existing safety
voice behavior for slow or unavailable inference.

The optional 8B config requires at least 16 GiB system RAM and a measured 6 GiB
brain budget after presenter/audio reservations. This is an admission minimum,
not a claim that 8B is fast enough. GPU offload and multi-room realtime quality
remain unmeasured here. CPU 4B should reserve at least 5 GiB on this tested
configuration because its measured RSS exceeds the GGUF file size.

## Actual CPU proof (not GPU or production realtime validation)

`workers/ai-live/local_brain_cpu_proof.py` produced
`.ai-live-dev/local-brain-proof/cpu-proof.json` using the real verified 4B model
on Windows, AMD64 Family 25 Model 116, 8 physical / 16 logical cores, 8 inference
threads, 16,863,055,872 bytes total RAM, 2,048 context tokens and no GPU layers.
The final proof uses current non-deprecated server flags. Six direct LLM
completions measure real inference separately from source template latency.

| Measured value | Final run |
| --- | ---: |
| Model file size | 2,497,280,256 bytes (2.33 GiB) |
| Response latency p50 / p95, six direct samples | 1,656.5 / 3,941.25 ms |
| First-token latency p50 / p95 | 1,023.5 / 1,077.5 ms |
| Median generation speed | 17.646 tokens/second |
| Runtime peak RSS | 4,763,901,952 bytes (4.44 GiB); sampled every 50 ms |
| Warmup / authenticated startup including hash checks | 640 / 6,032 ms |
| Real request interruption / timeout | `LOCAL_BRAIN_CANCELLED` after 296 ms / `LOCAL_BRAIN_TIMEOUT` after 63 ms |

Percentiles use linear interpolation over six samples, not a long-session
performance distribution. TTFT is measured from request admission to the first
content delta. Generation speed uses the server timing when supplied, otherwise
completion-token count divided by elapsed generation time after the first
token. Template responses do not have an LLM token speed or TTFT; sub-millisecond
template timing on this Windows monotonic clock is recorded as zero.

Actual direct-model observations:

| Comment | Direct Qwen output / limitation | Production source response |
| --- | --- | --- |
| สวัสดีค่ะ | Recited price/stock/options; greeting instruction not followed | สวัสดีค่ะ ยินดีต้อนรับเข้าร้านนะคะ |
| เสื้อตัวนี้ราคาเท่าไหร่ | `1,290 บาท` | ราคาสินค้าตอนนี้ 1,290 บาทค่ะ |
| มีของเหลือกี่ชิ้น | `มีของเหลือ 7 ชิ้น` | มีสินค้าเหลือ 7 ชิ้นค่ะ |
| สินค้ากันน้ำไหม | `ไม่ทราบข้อมูลการกันน้ำ` | ยังไม่พบข้อมูลนี้ในข้อมูลสินค้าของร้านค่ะ |
| มี size M สีอะไรบ้าง | Only `ขาว`; omitted another authoritative color and sizes | มีสี ดำ, ขาว ค่ะ มีขนาด S, M, L ค่ะ |
| ขอบคุณที่คุยเป็นเพื่อนนะ | Natural Thai general reply, but longer than one sentence | Local provider selects an approved non-factual phrase |

These real failures support deterministic grounding and the phrase guard.
They do not justify claiming unrestricted Thai commerce conversation quality.
The managed process is closed after measurement and health returns not ready.
All large binaries, GGUF files, logs and raw proof output stay in ignored DEV
artifacts, outside release source control. Nothing was bundled or deployed by
this proof.

The sandbox initially blocked local socket connections; the real proof was
rerun with authorized loopback access. No cloud inference was involved.

## Focused verification

29 focused unit tests pass in `workers/ai-live/tests/test_local_brain.py`:
intent routing, authoritative facts, missing-fact refusal, novel/spelled-number
claim rejection, offline templates with sockets blocked, cache invalidation,
owner/account/room isolation, request bounds, lifecycle, mandatory hashes,
path rejection, environment scrubbing, loopback authentication, non-thinking
requests, SSE bounds, cancellation, timeout and optional 8B admission.
The three Python modules also pass compilation checks. The real CPU proof
separately verifies loading, warmup, Thai examples, interruption, timeout,
metrics and process cleanup. Scheduler safety voice and full Digital Human
integration are verified by their separate integration tests/proofs.
The final raw CPU proof JSON SHA-256 is
`ecedb8e2971bfe0d76298569398c9b908d34c4f0f4d3a5d8da4aa92abeb2f791`.
