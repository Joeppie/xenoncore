#!/usr/bin/env node
// xenon — the craft workspace CLI (P10-S4: the COMPILE function).
//
//   xenon decompose <blueprint.json> <dir>   the hard disk → craft.json + src/<disk>/*.xc
//   xenon pack      <dir> [<out.json>]       the .xc files → the blueprint, byte-surgical
//                                            (default out: <dir>/packed.json;
//                                             pass the blueprint path as out = pack IN PLACE,
//                                             a .bak of the original rides along)
//   xenon programs  <blueprint.json>         list the disks (alias, kind, entry, files)
//   xenon diagnose  <blueprint.json> [alias] analyze every disk (exit 1 on HARD diagnostics)
import { existsSync, copyFileSync, readFileSync } from 'node:fs';
import { decomposeBlueprint, analyzeProject } from '../src/index.ts';
import { decomposeToDir, packDirToBlueprint } from '../src/workspace.ts';

const HARD = ['xc-undeclared-function', 'xc-unknown-function', 'xc-unknown-method',
  'xc-unknown-include', 'xc-duplicate-function', 'xc-missing-return'];

const [cmd, ...args] = process.argv.slice(2);
const die = (msg) => { console.error(`xenon ${cmd}: ${msg}`); process.exit(2); };

if (cmd === 'decompose') {
  const [bp, dir] = args;
  if (!bp || !dir) die('usage: xenon decompose <blueprint.json> <dir>');
  if (!existsSync(bp)) die(`no such blueprint: ${bp}`);
  const m = decomposeToDir(bp, dir);
  for (const p of m.programs)
    console.log(`${p.alias || `(ci-${p.ci})`}  ${p.kind}  entry=${p.entry ?? '-'}  ${p.files.length} files`);
  console.log(`→ ${dir}/craft.json + src/`);
} else if (cmd === 'pack') {
  const [dir, out] = args;
  if (!dir) die('usage: xenon pack <dir> [<out.json>]');
  const wp = JSON.parse(readFileSync(`${dir}/craft.json`, 'utf8'));
  const bpPath = wp.blueprint;
  if (!existsSync(bpPath)) die(`source blueprint missing: ${bpPath}`);
  const target = out ?? `${dir}/packed.json`;
  if (target === bpPath) copyFileSync(bpPath, `${bpPath}.bak`);
  packDirToBlueprint(dir, target);
  console.log(`→ ${target}${target === bpPath ? ' (in place; backup .bak)' : ''}`);
} else if (cmd === 'programs') {
  const [bp] = args;
  if (!bp) die('usage: xenon programs <blueprint.json>');
  const m = decomposeBlueprint(JSON.parse(readFileSync(bp, 'utf8')));
  for (const p of m.programs)
    console.log(`[${p.ci}] ${p.alias || '-'}  ${p.kind}  entry=${p.entry ?? '-'}  ` +
      `label=${JSON.stringify(p.label)} capacity=${p.capacity} files=${p.files.length}`);
  if (!m.programs.length) console.log('(no disks)');
} else if (cmd === 'diagnose') {
  const [bp, alias] = args;
  if (!bp) die('usage: xenon diagnose <blueprint.json> [alias]');
  const b = JSON.parse(readFileSync(bp, 'utf8'));
  const aliases = (b.data?.components ?? []).map(c => (c.alias ?? '').toLowerCase()).filter(Boolean);
  const m = decomposeBlueprint(b);
  let hard = 0, total = 0;
  for (const p of m.programs) {
    if (alias && p.alias !== alias) continue;
    const ds = analyzeProject(p.files.map(f => ({ name: f.name, code: f.plain_code })), { aliases });
    total += ds.length;
    for (const d of ds) {
      const isHard = HARD.includes(d.code);
      if (isHard) hard++;
      console.log(`${isHard ? 'ERROR' : 'warn '} ${p.alias || `(ci-${p.ci})`}/${d.file}:${d.line}  ${d.code}: ${d.message}`);
    }
  }
  console.log(`${m.programs.length} disks, ${total} diagnostics (${hard} hard)`);
  process.exit(hard ? 1 : 0);
} else {
  console.log('usage: xenon <decompose|pack|programs|diagnose> …  (P10: the craft workspace CLI)');
  process.exit(cmd ? 2 : 0);
}
