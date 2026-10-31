// workspace.test.ts — the S4 byte-surgery pins (package tier, synthetic
// raws; the CORPUS identity pin rides in the app, codec.pack.corpus.test.ts).
import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  jsonSpanOf, packBlueprintRaw, decomposeToDir, packDirToBlueprint,
} from '../workspace';
import { decomposeBlueprint, type BlueprintLike, type DiskFile } from '../codec';

// a game-shaped raw (single line, no spaces, raw non-ASCII, int literals)
const RAW = JSON.stringify({
  author: 'Zef\u2019z',
  mass: 1230.5000,
  data: {
    alias: 'span-test',
    components: [
      { type: 'PilotSeat', alias: 'seat', data: { emitPlayerToken: 0 } },
      { type: 'MiniComputer', alias: 'cpu', data: { hdd: { capacity: 256, label: 'OS', xc_files: [
        { name: 'main.xc', plain_code: 'include "lib.xc"\ninit\n\tprint("wörld")\n' },
        { name: 'lib.xc', plain_code: 'function @h()\n\tprint(1)\n' },
      ] } } },
      { type: 'HudController', alias: 'hud', data: { xc_files: [
        { name: 'main.xc', plain_code: 'init\n' },
      ] } },
    ],
  },
}).replace('"mass":1230.5', '"mass":1230.5000');   // the game's literal style

describe('jsonSpanOf (path-addressed byte spans)', () => {
  it('finds arrays, strings, objects and numbers by path', () => {
    const bp = JSON.parse(RAW) as BlueprintLike;
    void bp;
    const arr = jsonSpanOf(RAW, ['data', 'components', 1, 'data', 'hdd', 'xc_files'])!;
    expect(RAW.slice(arr[0], arr[1]).startsWith('[{')).toBe(true);
    const hud = jsonSpanOf(RAW, ['data', 'components', 2, 'data', 'xc_files'])!;
    expect(RAW.slice(hud[0], hud[1])).toBe('[{"name":"main.xc","plain_code":"init\\n"}]');
    const mass = jsonSpanOf(RAW, ['mass'])!;
    expect(RAW.slice(mass[0], mass[1])).toBe('1230.5000');
    expect(jsonSpanOf(RAW, ['data', 'components', 9, 'data'])).toBe(null);
  });
});

describe('packBlueprintRaw (the byte-surgery law)', () => {
  const man = decomposeBlueprint(JSON.parse(RAW) as BlueprintLike);
  it('NO edits ⇒ byte identity', () => {
    expect(packBlueprintRaw(RAW, man, new Map())).toBe(RAW);
  });
  it('one edit ⇒ the diff is bounded to that disk array', () => {
    const files: DiskFile[] = [{ name: 'main.xc', plain_code: 'init\n\tprint(2)\n' },
      { name: 'lib.xc', plain_code: 'function @h()\n\tprint(1)\n' }];
    const out = packBlueprintRaw(RAW, man, new Map([[1, files]]));
    expect(out).not.toBe(RAW);
    // prefix up to the disk array is byte-identical
    const span = jsonSpanOf(RAW, ['data', 'components', 1, 'data', 'hdd', 'xc_files'])!;
    expect(out.slice(0, span[0])).toBe(RAW.slice(0, span[0]));
    // suffix after the array too
    expect(out.slice(out.length - (RAW.length - span[1])))
      .toBe(RAW.slice(span[1]));
    const back = JSON.parse(out) as BlueprintLike;
    const xf = (back.data!.components![1]!.data!.hdd as { xc_files: DiskFile[] }).xc_files;
    expect(xf[0]!.plain_code).toBe('init\n\tprint(2)\n');
    expect(xf[1]!.plain_code).toBe('function @h()\n\tprint(1)\n');
    // untouched fields ride: mass keeps its literal bytes
    expect(out).toContain('"mass":1230.5000');
    expect(out).toContain('Zef\u2019z');
  });
  it('plain_code escapes roundtrip (quotes, newlines, non-ASCII)', () => {
    const files: DiskFile[] = [{ name: 'main.xc', plain_code: 'print("q\\"uote")\n; ünïcode ✓\n$tab\there\n' }];
    const out = packBlueprintRaw(RAW, man, new Map([[1, files]]));
    const back = JSON.parse(out) as BlueprintLike;
    const xf = (back.data!.components![1]!.data!.hdd as { xc_files: DiskFile[] }).xc_files;
    expect(xf[0]!.plain_code).toBe('print("q\\"uote")\n; ünïcode ✓\n$tab\there\n');
  });
  it('a fresh computer (no hdd key) gets the hdd INSERT, capacity/label from the manifest', () => {
    const raw = '{"data":{"components":[{"type":"MiniComputer","alias":"fresh","data":{}}]}}';
    const man2 = {
      craft: { alias: '', author: '', workshop_item_id: '', datetime: '' },
      programs: [{ ci: 0, alias: 'fresh', kind: 'MiniComputer' as const, entry: 'main.xc',
        label: 'fresh disk', capacity: 256,
        files: [{ name: 'main.xc', plain_code: 'init\n' }] }],
    };
    const out = packBlueprintRaw(raw, man2, new Map([[0, [{ name: 'main.xc', plain_code: 'init\n' }]]]));
    const back = JSON.parse(out) as BlueprintLike;
    const hdd = back.data!.components![0]!.data!.hdd as { capacity: number; label: string; xc_files: DiskFile[] };
    expect(hdd.capacity).toBe(256);
    expect(hdd.label).toBe('fresh disk');
    expect(hdd.xc_files[0]!.plain_code).toBe('init\n');
    expect(out).toContain('"data":{"hdd":{');
  });
});

describe('the workspace folder roundtrip (decompose → edit → pack)', () => {
  it('edits land, byte-surgical, over a real tmp layout', () => {
    const dir = mkdtempSync(join(tmpdir(), 'xenon-ws-'));
    try {
      const bpPath = join(dir, 'blueprint.json');
      writeFileSync(bpPath, RAW, 'utf8');
      const ws = join(dir, 'ws');
      const man = decomposeToDir(bpPath, ws);
      expect(man.programs.map(p => p.alias)).toEqual(['cpu', 'hud']);
      expect(existsSync(join(ws, 'craft.json'))).toBe(true);
      const mainPath = join(ws, 'src', 'cpu', 'main.xc');
      expect(readFileSync(mainPath, 'utf8')).toContain('wörld');
      // edit + add + delete:
      writeFileSync(mainPath, 'init\n\tprint("edited")\n', 'utf8');
      writeFileSync(join(ws, 'src', 'cpu', 'extra.xc'), 'function @x()\n\tprint(9)\n', 'utf8');
      rmSync(join(ws, 'src', 'cpu', 'lib.xc'));
      const out = join(dir, 'packed.json');
      packDirToBlueprint(ws, out);
      const raw2 = readFileSync(out, 'utf8');
      const back = JSON.parse(raw2) as BlueprintLike;
      const xf = (back.data!.components![1]!.data!.hdd as { xc_files: DiskFile[] }).xc_files;
      // deleted file drops; the survivor carries the edit; the add appends
      expect(xf.map(f => f.name)).toEqual(['main.xc', 'extra.xc']);
      expect(xf[0]!.plain_code).toBe('init\n\tprint("edited")\n');
      // untouched regions ride byte-identically (prefix + mass + hud disk)
      expect(raw2.slice(0, 40)).toBe(RAW.slice(0, 40));
      expect(raw2).toContain('"mass":1230.5000');
      const hud = (back.data!.components![2]!.data!.xc_files as DiskFile[]);
      expect(hud[0]!.plain_code).toBe('init\n');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
