#!/usr/bin/env node
// xenon-mcp — the MCP server over stdio (P10-S6: the AI XenonCode check).
// JSON-RPC 2.0 with Content-Length framing (the MCP stdio transport).
// Every tool answers from the SAME analysis surface the IDE uses — an AI
// (OpenCode/Claude/Cursor) can enumerate a craft's programs, diagnose
// disks, check pasted code against the vocabulary, and drive the
// decompose/pack COMPILE function — no game, no browser, no app.
import { readFileSync, existsSync } from 'node:fs';
import { decomposeBlueprint, analyzeProject, XC_SHIM_FUNCTIONS, XC_LANG_FUNCTIONS } from '../src/index.ts';
import { decomposeToDir, packDirToBlueprint } from '../src/workspace.ts';

const PROTOCOL = '2025-06-18';
const SERVER = { name: 'xenoncore', version: '0.2.0' };

const HARD = new Set(['xc-undeclared-function', 'xc-unknown-function', 'xc-unknown-method',
  'xc-unknown-include', 'xc-duplicate-function', 'xc-missing-return']);

const readBp = (p) => {
  if (!existsSync(p)) throw new Error(`no such blueprint: ${p}`);
  return JSON.parse(readFileSync(p, 'utf8'));
};
const aliasCensus = (b) =>
  (b.data?.components ?? []).map(c => (c.alias ?? '').toLowerCase()).filter(Boolean);
const diags = (files, aliases) =>
  analyzeProject(files, { aliases }).map(d => ({
    ...d, severity: HARD.has(d.code) ? 'error' : 'hint',
  }));

const TOOLS = [
  {
    name: 'list_programs',
    description: 'List the disk-host programs of an Archean blueprint.json (alias, kind, entry, label, capacity, files).',
    inputSchema: { type: 'object', properties: { blueprint: { type: 'string', description: 'path to blueprint.json' } }, required: ['blueprint'] },
  },
  {
    name: 'diagnose',
    description: 'Run the XenonCode analyzer over a craft\'s disks (optionally one alias). Returns diagnostics with severity (error = the HARD class: real defects on working code).',
    inputSchema: { type: 'object', properties: { blueprint: { type: 'string' }, alias: { type: 'string' } }, required: ['blueprint'] },
  },
  {
    name: 'analyze_code',
    description: 'Analyze RAW XenonCode (no craft): files [{name,code}], optional alias census for input_number("alias",…) checks. The AI write-check-loop tool.',
    inputSchema: { type: 'object', properties: { files: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, code: { type: 'string' } }, required: ['name', 'code'] } }, aliases: { type: 'array', items: { type: 'string' } } }, required: ['files'] },
  },
  {
    name: 'vocabulary',
    description: 'The XenonCode function vocabulary: device-shim functions (inputs/outputs/screens/beacons/panels) + interpreter/language functions. What a program MAY call.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'decompose',
    description: 'COMPILE function, step 1: extract a craft\'s hard disks into a workspace folder (craft.json manifest + src/<disk>/*.xc).',
    inputSchema: { type: 'object', properties: { blueprint: { type: 'string' }, dir: { type: 'string' } }, required: ['blueprint', 'dir'] },
  },
  {
    name: 'pack',
    description: 'COMPILE function, step 2: write a workspace\'s .xc files back into the blueprint (byte-surgical — every byte outside the edited plain_code strings rides unchanged).',
    inputSchema: { type: 'object', properties: { dir: { type: 'string' }, out: { type: 'string', description: 'output path (default <dir>/packed.json; = the source path to pack in place with a .bak)' } }, required: ['dir'] },
  },
];

function callTool(name, a) {
  if (name === 'list_programs') {
    const m = decomposeBlueprint(readBp(a.blueprint));
    return m.programs.map(p => ({
      alias: p.alias, kind: p.kind, entry: p.entry, label: p.label,
      capacity: p.capacity, files: p.files.map(f => ({ name: f.name, bytes: f.plain_code.length })),
    }));
  }
  if (name === 'diagnose') {
    const b = readBp(a.blueprint);
    const aliases = aliasCensus(b);
    const out = [];
    for (const p of decomposeBlueprint(b).programs) {
      if (a.alias && p.alias !== a.alias) continue;
      out.push({
        alias: p.alias, kind: p.kind,
        diagnostics: diags(p.files.map(f => ({ name: f.name, code: f.plain_code })), aliases),
      });
    }
    return out;
  }
  if (name === 'analyze_code')
    return diags(a.files, (a.aliases ?? []).map(s => String(s).toLowerCase()));
  if (name === 'vocabulary')
    return {
      device_shim: [...XC_SHIM_FUNCTIONS].sort(),
      language: [...XC_LANG_FUNCTIONS].sort(),
      note: 'device set = the xc_host.cpp shim (pinned by test); HUD-only builtins (panel()/set_cps) exist in the set — they fire only in HUD mode at runtime',
    };
  if (name === 'decompose') {
    const m = decomposeToDir(a.blueprint, a.dir);
    return { dir: a.dir, programs: m.programs.map(p => p.alias || `ci-${p.ci}`) };
  }
  if (name === 'pack') {
    const wp = packDirToBlueprint(a.dir, a.out ?? `${a.dir}/packed.json`);
    return { packed: a.out ?? `${a.dir}/packed.json`, programs: wp.programs.length };
  }
  throw new Error(`unknown tool: ${name}`);
}

// ── the stdio JSON-RPC loop (Content-Length framing) ──────────────────────

let buf = Buffer.alloc(0);
const send = (msg) => {
  const body = JSON.stringify(msg);
  process.stdout.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
};
const handle = (m) => {
  if (m.method === 'initialize')
    return send({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: PROTOCOL, capabilities: { tools: {} }, serverInfo: SERVER } });
  if (m.method === 'notifications/initialized' || (m.method ?? '').startsWith('notifications/')) return;
  if (m.method === 'ping') return send({ jsonrpc: '2.0', id: m.id, result: {} });
  if (m.method === 'tools/list')
    return send({ jsonrpc: '2.0', id: m.id, result: { tools: TOOLS } });
  if (m.method === 'tools/call') {
    try {
      const r = callTool(m.params.name, m.params.arguments ?? {});
      return send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: JSON.stringify(r, null, 1) }] } });
    } catch (e) {
      return send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: String(e?.message ?? e) }], isError: true } });
    }
  }
  if (m.id !== undefined)
    send({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: `method not found: ${m.method}` } });
};
process.stdin.on('data', (chunk) => {
  buf = Buffer.concat([buf, chunk]);
  for (;;) {
    const head = buf.indexOf('\r\n\r\n');
    if (head < 0) return;
    const h = buf.subarray(0, head).toString();
    const len = Number(/Content-Length: *(\d+)/i.exec(h)?.[1] ?? -1);
    if (!Number.isFinite(len) || len < 0) { buf = Buffer.alloc(0); return; }
    if (buf.length < head + 4 + len) return;
    const body = buf.subarray(head + 4, head + 4 + len).toString();
    buf = buf.subarray(head + 4 + len);
    try { handle(JSON.parse(body)); } catch { /* keep serving */ }
  }
});
