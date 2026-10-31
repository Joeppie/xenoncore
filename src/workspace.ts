// workspace.ts — the S4 fs/CLI layer (P10): decompose a craft blueprint
// into a WORKSPACE FOLDER and pack it back with SURGICAL BYTE EDITING.
//
// packBlueprintRaw NEVER JSON.parse→stringify round-trips the blueprint
// (that reformats every float the game wrote — the byte-identical law).
// It locates each disk's `xc_files` ARRAY BY BYTE SPAN in the raw file and
// replaces exactly that span; everything outside the replaced spans rides
// byte-for-byte. The corpus pin (app repo, codec.pack.corpus.test.ts)
// proves: no edits ⇒ byte identity; one edit ⇒ the diff is bounded to
// that plain_code string. The emitted array follows the game's writer:
// separators (',',':'), ensure_ascii=False — exactly JSON.stringify.
//
// Node-only (fs) — the codec.ts core stays pure.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  decomposeBlueprint, composeFiles,
  type BlueprintLike, type DiskFile, type ProgramDisk, type WorkspaceManifest,
} from './codec';

// ── raw JSON span finder (path-addressed byte spans) ──────────────────────


/** Byte span [start, end) of the value at `path` (keys + array indices),
 *  or null when the path is absent. Throws on malformed JSON. */
export function jsonSpanOf(raw: string, path: (string | number)[]): [number, number] | null {
  const n = raw.length;
  let i = 0;
  let found: [number, number] | null = null;
  const skipWs = () => { while (i < n && /\s/.test(raw[i]!)) i++; };
  const str = (): string => {
    const s = i;
    i++;                                             // opening quote
    while (i < n) {
      if (raw[i] === '\\') i += 2;
      else if (raw[i] === '"') { i++; break; }
      else i++;
    }
    return JSON.parse(raw.slice(s, i)) as string;
  };
  const value = (depth: number, match: boolean): void => {
    skipWs();
    const start = i;
    const c = raw[i];
    if (c === '{') {
      i++; skipWs();
      if (raw[i] === '}') i++;
      else for (;;) {
        skipWs();
        const key = str();
        skipWs();
        if (raw[i] !== ':') throw new Error(`jsonSpanOf: expected ':' at ${i}`);
        i++;
        value(depth + 1, match && path[depth] === key);
        skipWs();
        if (raw[i] === ',') { i++; continue; }
        if (raw[i] === '}') { i++; break; }
        throw new Error(`jsonSpanOf: malformed object at ${i}`);
      }
    } else if (c === '[') {
      i++; skipWs();
      if (raw[i] === ']') i++;
      else for (let idx = 0; ; idx++) {
        value(depth + 1, match && path[depth] === idx);
        skipWs();
        if (raw[i] === ',') { i++; continue; }
        if (raw[i] === ']') { i++; break; }
        throw new Error(`jsonSpanOf: malformed array at ${i}`);
      }
    } else if (c === '"') {
      str();
    } else {
      while (i < n && !',}]\n\r\t '.includes(raw[i]!)) i++;
    }
    if (match && depth === path.length) found = [start, i];
  };
  value(0, true);
  return found;
}

// ── the surgical packer ───────────────────────────────────────────────────

function diskPath(p: ProgramDisk): (string | number)[] {
  return p.kind === 'HudController'
    ? ['data', 'components', p.ci, 'data', 'xc_files']
    : ['data', 'components', p.ci, 'data', 'hdd', 'xc_files'];
}

/**
 * Replace each edited program's xc_files ARRAY bytes in the raw blueprint
 * (game-writer style: `[{name,plain_code},…]`, separators (',',':'),
 * non-ASCII raw — exactly JSON.stringify). Programs absent from `edited`
 * ride untouched. A disk the file does not (yet) carry gets a fresh
 * `hdd`/`xc_files` INSERTED into the component's data object (the
 * fresh-computer layout, edit.ts v1.13.20 law) — capacity/label from the
 * manifest, never invented.
 */
export function packBlueprintRaw(
  raw: string,
  manifest: WorkspaceManifest,
  edited: Map<number, DiskFile[]>,
): string {
  const edits: [number, number, string][] = [];
  for (const [ci, files] of edited) {
    const prog = manifest.programs.find(p => p.ci === ci);
    if (!prog) throw new Error(`ci ${ci} is not a program in the manifest`);
    const json = JSON.stringify(files);
    const span = jsonSpanOf(raw, diskPath(prog));
    if (span) { edits.push([span[0], span[1], json]); continue; }
    // fresh disk: insert into the component's data object
    const dataSpan = jsonSpanOf(raw, ['data', 'components', ci, 'data']);
    if (!dataSpan) throw new Error(`component ${ci} carries no data object`);
    const inner = raw.slice(dataSpan[0] + 1, dataSpan[1] - 1).trim();
    const frag = prog.kind === 'HudController'
      ? `${inner ? ',' : ''}"xc_files":${json}`
      : `${inner ? ',' : ''}"hdd":{"capacity":${prog.capacity || 256},"label":${JSON.stringify(prog.label)},"xc_files":${json}}`;
    const at = dataSpan[1] - 1;
    edits.push([at, at, frag]);
  }
  edits.sort((a, b) => b[0] - a[0]);
  let out = raw;
  for (const [s, e, txt] of edits) out = out.slice(0, s) + txt + out.slice(e);
  return out;
}

// ── the workspace folder (the COMPILE function's on-disk shape) ───────────

export interface WorkspaceProgramEntry {
  ci: number;
  alias: string;
  kind: string;
  entry: string | null;
  label: string;
  capacity: number;
  srcDir: string;              // relative to the workspace root
  files: string[];             // disk names, ORDER = the disk's file-table order
}
export interface WorkspaceJson {
  source: 'blueprint';
  blueprint: string;           // the blueprint file the workspace came from
  craft: WorkspaceManifest['craft'];
  programs: WorkspaceProgramEntry[];
}

const safeDir = (alias: string, ci: number) =>
  (alias.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || `ci-${ci}`);

/** Write <dir>/craft.json + <dir>/src/<name>/*.xc verbatim; returns the manifest. */
export function decomposeToDir(blueprintPath: string, dir: string): WorkspaceManifest {
  const raw = readFileSync(blueprintPath, 'utf8');
  const manifest = decomposeBlueprint(JSON.parse(raw) as BlueprintLike);
  mkdirSync(dir, { recursive: true });
  const entries: WorkspaceProgramEntry[] = manifest.programs.map(p => {
    const srcDir = join('src', safeDir(p.alias, p.ci));
    const abs = join(dir, srcDir);
    mkdirSync(abs, { recursive: true });
    for (const f of p.files) writeFileSync(join(abs, f.name), f.plain_code, 'utf8');
    return {
      ci: p.ci, alias: p.alias, kind: p.kind, entry: p.entry,
      label: p.label, capacity: p.capacity, srcDir, files: p.files.map(f => f.name),
    };
  });
  const wp: WorkspaceJson = {
    source: 'blueprint',
    blueprint: blueprintPath,
    craft: manifest.craft,
    programs: entries,
  };
  writeFileSync(join(dir, 'craft.json'), JSON.stringify(wp, null, 2) + '\n', 'utf8');
  return manifest;
}

/**
 * Read the workspace's .xc files (deletions = missing files; new .xc files
 * = additions, appended) and write the packed blueprint through
 * packBlueprintRaw. Returns the workspace manifest read.
 */
export function packDirToBlueprint(
  dir: string, outPath: string, blueprintPath?: string,
): WorkspaceJson {
  const wp = JSON.parse(readFileSync(join(dir, 'craft.json'), 'utf8')) as WorkspaceJson;
  const raw = readFileSync(blueprintPath ?? wp.blueprint, 'utf8');
  const edited = new Map<number, DiskFile[]>();
  for (const e of wp.programs) {
    const abs = join(dir, e.srcDir);
    const diskPresent = existsSync(abs) ? readdirSync(abs).filter(f => f.endsWith('.xc')) : [];
    const read = (name: string) => readFileSync(join(abs, name), 'utf8');
    const editedFiles: DiskFile[] = [
      ...diskPresent.filter(f => e.files.includes(f)).map(f => ({ name: f, plain_code: read(f) })),
      ...diskPresent.filter(f => !e.files.includes(f)).sort().map(f => ({ name: f, plain_code: read(f) })),
    ];
    // the craft.json file-table order is the disk's ORIGINAL order — the
    // compose law (originals ride in order, adds append, deletes drop)
    const originals: DiskFile[] = e.files.map(name => {
      const f = editedFiles.find(x => x.name === name);
      return { name, plain_code: f?.plain_code ?? '' };
    });
    edited.set(e.ci, composeFiles(originals, editedFiles));
  }
  writeFileSync(outPath, packBlueprintRaw(raw, manifestOf(wp), edited), 'utf8');
  return wp;
}

function manifestOf(wp: WorkspaceJson): WorkspaceManifest {
  return {
    craft: wp.craft,
    programs: wp.programs.map(e => ({
      ci: e.ci, alias: e.alias, kind: e.kind as ProgramDisk['kind'],
      entry: e.entry, label: e.label, capacity: e.capacity, files: [],
    })),
  };
}
