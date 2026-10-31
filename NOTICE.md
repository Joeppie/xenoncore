# NOTICE — provenance and licensing

## 1. Our code

`src/`, `tools/xenoncode/xc_host.cpp`, `xc_host.h`, `build.sh`, the patches'
harvesting tooling, and the demos are GPL-3.0 (see LICENSE), authored in
the open for the Archean tooling family
(archean-blueprint-tools, xenoncode-vscode). No rights-holder permissions
are claimed; reuse is presumed in good faith, CC-attribution spirit;
rights-holder objections are handled amicably via issues.

## 2. The XenonCode interpreter

`tools/xenoncode/upstream/` is a git submodule pinning
https://github.com/Joeppie/XenonCode branch `archean` — the public fork of
batcholi/XenonCode (by batcholi / FloDKSM, the game's developer), at the
commit recorded in `tools/xenoncode/XENONCODE_UPSTREAM.md`, plus OUR
patches as real commits (tagged XENON-VARS, XENON-DEBUG,
XENON-LENIENT-INDEX). The interpreter sources (`XenonCode.hpp`,
`XenonScreen.hpp`) and the compiled `xenoncode.js`/`xenoncode.wasm` built
from them belong to their author; `build.sh` builds ONLY the pinned
gitlink and refuses a diverged checkout.

## 3. The device shim

`xc_host.cpp` is OURS: it implements Archean's device/channel law (the
wiki-documented io channels, screens, beacons, HUD panels) against the
interpreter. The game itself is © the developer; this repo ships NO game
binaries, assets, data, or machine-local paths.

## 4. The blueprint format

The format knowledge encoded in `codec.ts` is reverse-engineered from
published game saves and documented in the blueprint repo's FORMAT.md.
Craft files users point the tools at belong to their authors.
