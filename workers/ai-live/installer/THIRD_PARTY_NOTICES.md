# Local Live Agent component notices

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

No lip-sync models, CUDA toolkit, NVIDIA drivers, GPU inference libraries, or
live-streaming performance validation are included.
