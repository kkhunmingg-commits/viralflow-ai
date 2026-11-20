# ViralFlow AI component notices

This offline Windows test package includes the Python runtime and Tcl/Tk, the
PyInstaller bootloader (GPL with its bundling exception), cryptography
(Apache-2.0 or BSD-3-Clause), cffi (MIT), sounddevice 0.5.1 (MIT), PortAudio
(MIT), and the project's existing FFmpeg 6.1.1
Windows essentials build. Bundled library metadata includes their notices.

sounddevice's LICENSE is bundled in its distribution metadata. The PortAudio
binary, upstream library notices and distribution README are bundled under
`_internal/_sounddevice_data/portaudio-binaries/`. These support direct local
microphone capture; no virtual audio driver is installed.

FFmpeg is a separate executable used through a local process boundary, not a
linked proprietary library. Its GPL-v3 license and build configuration are
included beside `ffmpeg.exe` as `ffmpeg.exe.LICENSE` and `ffmpeg.exe.README`.
Upstream source/build links: https://github.com/FFmpeg/FFmpeg/commit/e38092ef93
and https://www.gyan.dev/ffmpeg/builds/. Public binary distribution must provide
the corresponding source for FFmpeg and its enabled external libraries under
their applicable licenses; this local engineering package is not a production
distribution release or source offer.

The small engineering setup has no model weights, GPU inference dependencies or
NVIDIA driver installer. First-run presenter runtime/model archives must carry
their own upstream license notices and immutable source/hash provenance before a
publisher signs a release. CPU engineering assets use MuseTalk 1.5 (MIT),
sd-vae-ft-mse (model card MIT), and Whisper (Apache-2.0); dependency wheels retain
their distribution license metadata. Publication still requires review of all
transitive dependencies, model redistribution rights, and FFmpeg corresponding
source obligations. No managed archive or signing private key is published by
this work, and packaging does not establish live-streaming performance validation.
