// codec.test.ts — the codec's PURE pins (P10 S4 seed, package tier): the
// entry-selection law, the {name, plain_code} key-order + file-order laws,
// the #NODES preservation law, and the content-hash world bridge on
// synthetic disks. THE CORPUS LEGS (528 real disk files roundtrip
// byte-identically, real #NODES counts, real world-bridge disks) ride in
// the consuming app — the corpus lives there (L1: only the app tier can
// state a law over the corpus).
import { describe, expect, it } from 'vitest';
import {
  decomposeBlueprint, composeFiles, pickEntry, nodesHeader, nodesViolations,
  contentHash, matchWorldHdds, programKindOf,
  type BlueprintLike, type DiskFile, type ProgramDisk,
} from '../codec';

const disk = (alias: string, files: DiskFile[]): ProgramDisk => ({
  ci: 0, alias, kind: 'MiniComputer', entry: pickEntry(files.map(f => f.name)),
  label: 'L', capacity: 256, files,
});
const manifest = (programs: ProgramDisk[]) => ({
  craft: { alias: '', author: '', workshop_item_id: '', datetime: '' },
  programs,
});

describe('entry-selection law (the xenonComputers law)', () => {
  it('<program>.main.xc wins over a literal main.xc', () => {
    expect(pickEntry(['main.xc', 'Cede.main.xc', 'screen.xc'])).toBe('Cede.main.xc');
  });
  it('literal main.xc when no program main exists', () => {
    expect(pickEntry(['main.xc', 'lib.xc'])).toBe('main.xc');
  });
  it('falls back to the first file', () => {
    expect(pickEntry(['a.xc', 'b.xc'])).toBe('a.xc');
    expect(pickEntry([])).toBe(null);
  });
});

describe('program kinds + decompose', () => {
  it('maps the four disk hosts, rejects the rest', () => {
    expect(programKindOf('Computer')).toBe('Computer');
    expect(programKindOf('MiniComputer')).toBe('MiniComputer');
    expect(programKindOf('Crafter')).toBe('Crafter');
    expect(programKindOf('HudController')).toBe('HudController');
    expect(programKindOf('PilotSeat')).toBe(null);
    expect(programKindOf(undefined)).toBe(null);
  });
  it('reads the hdd container for computers, the DIRECT one for HUDs', () => {
    const bp: BlueprintLike = {
      data: { components: [
        { type: 'MiniComputer', alias: 'cpu', data: { hdd: { capacity: 256, label: 'x', xc_files: [{ name: 'main.xc', plain_code: 'init\n' }] } } },
        { type: 'HudController', alias: 'hud', data: { xc_files: [{ name: 'main.xc', plain_code: 'init\n' }] } },
        { type: 'PilotSeat', data: {} },
      ] },
    };
    const m = decomposeBlueprint(bp);
    expect(m.programs.map(p => [p.ci, p.kind, p.capacity])).toEqual(
      [[0, 'MiniComputer', 256], [1, 'HudController', 0]]);
  });
  it('decompose NEVER mutates the blueprint', () => {
    const bp: BlueprintLike = {
      data: { components: [
        { type: 'Computer', alias: 'c', data: { hdd: { capacity: 1, label: '', xc_files: [{ name: 'main.xc', plain_code: 'x' }] } } },
      ] },
    };
    const before = JSON.stringify(bp);
    decomposeBlueprint(bp);
    expect(JSON.stringify(bp)).toBe(before);
  });
});

describe('THE COMPOSITION LAWS', () => {
  it('key order is exactly {name, plain_code} on composed records', () => {
    const out = composeFiles(
      [{ name: 'a.xc', plain_code: 'x' }],
      [{ name: 'a.xc', plain_code: 'X' }]);
    expect(JSON.stringify(out[0])).toBe('{"name":"a.xc","plain_code":"X"}');
  });
  it('original file order rides through; adds append; deletes drop', () => {
    const orig = ['a.xc', 'b.xc', 'c.xc'].map(n => ({ name: n, plain_code: n }));
    const edited = [{ name: 'c.xc', plain_code: 'c' }, { name: 'a.xc', plain_code: 'A' },
      { name: 'd.xc', plain_code: 'd' }];
    expect(composeFiles(orig, edited).map(f => f.name)).toEqual(['a.xc', 'c.xc', 'd.xc']);
  });
  it('compose of an untouched decompose is identity', () => {
    const orig: DiskFile[] = [
      { name: 'main.xc', plain_code: 'include "lib.xc"\ninit\n' },
      { name: 'lib.xc', plain_code: 'function @h()\n\tprint(1)\n' },
    ];
    expect(JSON.stringify(composeFiles(orig, orig.map(f => ({ ...f })))))
      .toBe(JSON.stringify(orig));
  });
});

describe('THE #NODES PRESERVATION LAW', () => {
  it('detects the first-line header only', () => {
    expect(nodesHeader('#NODES {"a":1}\nbody')).toBe('#NODES {"a":1}');
    expect(nodesHeader('init\nprint(1)\n')).toBe(null);
    expect(nodesHeader('; #NODES not-first')).toBe(null);
  });
  it('body edits are clean; header loss/reformat is a violation', () => {
    const orig: DiskFile[] = [{ name: 'flight.main.xc', plain_code: '#NODES {"n":1}\ninit\n' }];
    expect(nodesViolations(orig, composeFiles(orig,
      [{ name: 'flight.main.xc', plain_code: '#NODES {"n":1}\ninit\n\tprint(1)\n' }]))).toEqual([]);
    expect(nodesViolations(orig, composeFiles(orig,
      [{ name: 'flight.main.xc', plain_code: 'init\n\tprint(1)\n' }]))).toEqual(['flight.main.xc']);
    expect(nodesViolations(orig, composeFiles(orig,
      [{ name: 'flight.main.xc', plain_code: '#NODES  {"n":1}\ninit\n' }]))).toEqual(['flight.main.xc']);
  });
});

describe('the world-save bridge (content hash; entitystate RE is BANNED)', () => {
  it('contentHash is stable, input-sensitive, length-safe', () => {
    expect(contentHash('init\n')).toBe(contentHash('init\n'));
    expect(contentHash('init\n')).not.toBe(contentHash('init\n\tprint(1)\n'));
    expect(contentHash('ab')).not.toBe(contentHash('cd'));
  });
  it('world HDD dirs map to their programs at score 1 (decoys stay out)', () => {
    const a = disk('chip', [{ name: 'main.xc', plain_code: 'include "os.xc"\ninit\n' },
      { name: 'os.xc', plain_code: 'function @os()\n\tprint(1)\n' }]);
    const b = disk('app', [{ name: 'main.xc', plain_code: 'include "os.xc"\ninit\n\t@os()\n' }]);
    const hdds = [
      { id: 'HDD-AAA', files: a.files.map(f => ({ name: f.name, code: f.plain_code })) },
      { id: 'HDD-BBB', files: b.files.map(f => ({ name: f.name, code: f.plain_code })) },
      { id: 'HDD-CCC', files: [{ name: 'main.xc', code: 'init\n\tprint("other craft")\n' }] },
    ];
    const m = matchWorldHdds(manifest([a, b]), hdds);
    expect(m.find(x => x.alias === 'chip')!.hddId).toBe('HDD-AAA');
    expect(m.find(x => x.alias === 'chip')!.score).toBe(1);
    expect(m.find(x => x.alias === 'app')!.hddId).toBe('HDD-BBB');
  });
  it('a byte-drifted world file still maps (fractional score)', () => {
    const a = disk('cpu', [{ name: 'main.xc', plain_code: 'init\n\tprint(1)\n' },
      { name: 'big.xc', plain_code: 'x'.repeat(1000) }]);
    const drifted = a.files.map((f, i) => ({
      name: f.name,
      code: i === 0 ? f.plain_code + '; autosave note\n' : f.plain_code,
    }));
    const m = matchWorldHdds(manifest([a]), [{ id: 'HDD-DRIFT', files: drifted }]);
    expect(m[0]!.hddId).toBe('HDD-DRIFT');
    expect(m[0]!.score).toBeGreaterThanOrEqual(0.5);
    expect(m[0]!.score).toBeLessThan(1);
  });
  it('an unrelated dir maps to nothing', () => {
    const a = disk('cpu', [{ name: 'main.xc', plain_code: 'init\n\tprint(1)\n' }]);
    const m = matchWorldHdds(manifest([a]),
      [{ id: 'HDD-X', files: [{ name: 'main.xc', code: 'init\n\tprint(9)\n' }] }]);
    expect(m[0]!.hddId).toBe(null);
  });
});
