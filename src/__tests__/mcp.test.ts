// mcp.test.ts — the MCP bin speaks its protocol (S6): spawn the BUILT bin
// (npm test builds first), initialize → tools/list → analyze_code +
// vocabulary, and the analyze loop's HARD-severity law.
import { describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const BIN = join(dirname(fileURLToPath(import.meta.url)), '../../dist/bin/mcp.mjs');

interface Msg { jsonrpc: string; id?: number; method?: string; params?: unknown; result?: any; error?: any }

function client() {
  const p = spawn(process.execPath, [BIN], { stdio: ['pipe', 'pipe', 'pipe'] });
  const pending = new Map<number, (m: Msg) => void>();
  let buf = Buffer.alloc(0);
  let nextId = 1;
  p.stdout.on('data', (c) => {
    buf = Buffer.concat([buf, c]);
    for (;;) {
      const h = buf.indexOf('\r\n\r\n');
      if (h < 0) return;
      const len = Number(/Content-Length: *(\d+)/i.exec(buf.subarray(0, h).toString())?.[1] ?? -1);
      if (buf.length < h + 4 + len) return;
      const m = JSON.parse(buf.subarray(h + 4, h + 4 + len).toString()) as Msg;
      buf = buf.subarray(h + 4 + len);
      if (m.id !== undefined && pending.has(m.id)) { pending.get(m.id)!(m); pending.delete(m.id); }
    }
  });
  const rpc = (method: string, params?: unknown) => new Promise<Msg>((res) => {
    const id = nextId++;
    pending.set(id, res);
    const body = JSON.stringify({ jsonrpc: '2.0', id, method, params });
    p.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
  });
  const notify = (method: string) => {
    const body = JSON.stringify({ jsonrpc: '2.0', method });
    p.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
  };
  return { p, rpc, notify };
}
const text = (m: Msg) => JSON.parse(m.result.content[0].text);

describe('xenon-mcp (stdio JSON-RPC)', () => {
  it('initialize → tools/list → analyze_code → vocabulary', async () => {
    expect(existsSync(BIN), 'npm test builds dist/bin first').toBe(true);
    const c = client();
    try {
      const init = await c.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } });
      expect(init.result.serverInfo.name).toBe('xenoncore');
      c.notify('notifications/initialized');
      const list = await c.rpc('tools/list');
      const names = list.result.tools.map((t: { name: string }) => t.name);
      expect(names).toEqual(expect.arrayContaining(
        ['list_programs', 'diagnose', 'analyze_code', 'vocabulary', 'decompose', 'pack']));
      const bad = text(await c.rpc('tools/call', {
        name: 'analyze_code',
        arguments: { files: [{ name: 'main.xc', code: 'init\n\tmade_up_fn(1)\n' }] },
      }));
      expect(bad.some((d: { code: string; severity: string }) =>
        d.code === 'xc-unknown-function' && d.severity === 'error')).toBe(true);
      const clean = text(await c.rpc('tools/call', {
        name: 'analyze_code',
        arguments: { files: [{ name: 'main.xc', code: 'init\n\tprint(input_number(1, 0))\n' }] },
      }));
      expect(clean.filter((d: { severity: string }) => d.severity === 'error')).toEqual([]);
      const vocab = text(await c.rpc('tools/call', { name: 'vocabulary', arguments: {} }));
      expect(vocab.device_shim.length).toBeGreaterThan(60);
      expect([...vocab.device_shim, ...vocab.language]).toContain('print');
      expect(vocab.language).toContain('size');
    } finally {
      c.p.kill();
    }
  }, 20_000);
});
