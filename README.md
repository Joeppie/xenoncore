# xenoncore — the XenonCode language core

The XenonCode stack for the game **Archean**, isolated from any app: the
**project model, analyzer, function-reference docs, program sites, and the
craft decompose/pack codec**. Pure TypeScript — no React, no three.js, no
DOM, no machine-local paths. Consumers today: the
[archean-blueprint-tools](https://github.com/Joeppie/archean-blueprint-tools)
editor (a tag-pinned git dep); planned: a VS Code extension (LSP + debug
adapter + the COMPILE function) and an MCP bin for AI-assisted XenonCode.
The plan this repo implements is
[REWRITE § P10](https://github.com/Joeppie/archean-blueprint-tools/blob/main/REWRITE.md).

## Layout

```
src/
  xcproject.ts   project model: .xc files → function index, include order,
                 declarations, the library/keyword/const vocabulary tables
  xcanalyze.ts   the analyzer: VS-style diagnostics (11 codes); the
                 vocabulary sets are re-derived from the C++ sources (the
                 pins below keep them synced to the binary)
  xcdocs.ts      the function-reference hover: every vocabulary name →
                 signature + description + origin (coverage law pinned)
  xcsites.ts     program sites: the button_rect/input_* literal census the
                 press-chips use (last-containing-window wins)
  codec.ts       the craft ⇄ workspace codec (the COMPILE function core):
                 decomposeBlueprint, the entry-selection law, composeFiles
                 (the game's {name, plain_code} key-order + file-order
                 laws), the #NODES preservation law, and matchWorldHdds —
                 the content-hash bridge from a game world-save
                 ARCHEAN_computer/HDD-*/ dir back to a craft's programs
  index.ts       the public surface
tools/xenoncode/
  xc_host.cpp    OUR device shim (Archean's device/channel law, ABI-stamped)
  build.sh       the build chain: native xc_run + browser wasm glue, built
                 ONLY from the pinned submodule gitlink (it refuses a
                 diverged checkout); set APP_ASSETS=<dir> to also install
                 xenoncode.js/.wasm into a consumer's asset folder
  upstream/      git submodule: github.com/Joeppie/XenonCode branch
                 `archean` = batcholi/XenonCode + our tagged patches
                 (XENON-VARS, XENON-DEBUG, XENON-LENIENT-INDEX)
  index.html     the zero-dependency playground (boots glue+wasm directly)
  demo/          demo programs (hello, hudradio, worldsim)
```

## Format ground truth

A craft's disks ride in `blueprint.json` at
`components[].data.hdd.xc_files = [{name, plain_code}]` (source only — the
game recompiles; `capacity`/`label` are carried verbatim), and the game's
own server world saves decompose live disks into
`ARCHEAN_computer/HDD-<24hex>/` dirs with a `#NODES` visual-editor header
as the FIRST LINE of every `.main.xc`. The codec mirrors those laws; the
full write-up lives in the blueprint repo's
[FORMAT.md](https://github.com/Joeppie/archean-blueprint-tools/blob/main/FORMAT.md)
(§ Xenon virtual disk).

## Development

**Wasm artifacts and git deps:** the `.wasm` rides git LFS — an npm *git*
dep clone sees the pointer file, so consumers bundle their own asset copy
(currently `app/src/engine/xenoncode/` in the blueprint app, refreshed by
the bump ritual below); npm-registry publishes ship the real bytes.

```bash
git submodule update --init          # the pinned interpreter fork
npm install
npm test                             # vitest (pure node tier)
npm run typecheck                    # tsc --noEmit (strict)
# rebuild the wasm from the pinned gitlink (emscripten required):
EMSDK=~/emsdk tools/xenoncode/build.sh wasm-only
# ...then bump the artifacts in the same commit, and in consumers:
#   APP_ASSETS=<consumer asset dir> tools/xenoncode/build.sh wasm-only
```

The pins that keep the system honest:

- **vocabulary sync**: every `DeclareDeviceFunction`/member-map name in
  `xc_host.cpp` and every interpreter registration in `XenonCode.hpp` is
  in the analyzer's sets (the binary is the source of truth).
- **doc coverage**: every vocabulary name has a hover doc.
- **the TRUE-NEGATIVE law** (runs in the consuming app over the real
  corpus): shipped programs (ChipOS, the Badger disk, player HUDs) analyze
  with ZERO hard diagnostics — a false positive on working code is a bug.

## Licensing

Our code: GPL-3.0 (LICENSE). The interpreter is the dev's own XenonCode
(NOTICE.md); the submodule pins our patches as real commits on the fork —
upstream PRs are welcome from that branch. No game assets ship here.
