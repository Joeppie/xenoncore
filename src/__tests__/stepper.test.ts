// stepper.test.ts — THE STEPPER LAW pins (moved verbatim from the app's
// xenoncode.test at S2a). The law is dual-site in production (app pump ⇄
// EM_JS hook); pinned here so a drift in either reading (over = same-file
// fresh pair at depth <= paused depth · into = any fresh pair · to = exact
// pair · breaks = exact, keep the step mode) fails at the package tier.
import { describe, expect, it } from 'vitest';
import { encodePair as pair, stepperLaw } from '../stepper';

describe('THE STEPPER LAW (dual-site: applyCycle walk ⇄ EM_JS hook)', () => {
  const FT = ['main.xc', 'game.xc'];
  const S = (o: Partial<Parameters<typeof stepperLaw>[4]> = {}) => ({
    stepMode: 'off', pausedFile: 'main.xc', pausedLine: 0, pausedDepth: 0,
    toFile: '', toLine: 0, scope: null, ...o,
  } as Parameters<typeof stepperLaw>[4]);
  it('idle: no pairs, or no step mode and no breakpoints ⇒ no stop', () => {
    expect(stepperLaw([pair(0, 5)], undefined, FT, new Map(), S())).toBeNull();
  });
  it('a breakpoint stops AT the exact pair and KEEPS an armed step mode', () => {
    const breaks = new Map([['game.xc', new Set([42])]]);
    const h = stepperLaw([pair(0, 7), pair(1, 42), pair(0, 8)], undefined, FT, breaks,
      S({ stepMode: 'into', pausedFile: 'main.xc', pausedLine: 7 }));
    expect(h).toEqual({ file: 'game.xc', line: 42, stepMode: 'into', depth: 0 });
  });
  it('runTo stops on the EXACT (file,line) and disarms', () => {
    const st = S({ stepMode: 'to', toFile: 'game.xc', toLine: 20 });
    expect(stepperLaw([pair(0, 3), pair(1, 19)], undefined, FT, new Map(), st)).toBeNull();
    expect(stepperLaw([pair(1, 20)], undefined, FT, new Map(), st))
      .toEqual({ file: 'game.xc', line: 20, stepMode: 'off', depth: 0 });
  });
  it('into (F11): the FIRST fresh pair anywhere — the re-stop on the same pair (loop line) is not fresh', () => {
    const st = S({ stepMode: 'into', pausedFile: 'main.xc', pausedLine: 10 });
    expect(stepperLaw([pair(0, 10), pair(0, 10)], undefined, FT, new Map(), st)).toBeNull();
    expect(stepperLaw([pair(0, 10), pair(1, 2)], undefined, FT, new Map(), st))
      .toEqual({ file: 'game.xc', line: 2, stepMode: 'off', depth: 0 });   // steps INTO the @call file
  });
  it('over (F10, v1.13.28 CLASSIC law): stops at the first FRESH pair of the SAME file — the next line at the current frame; other-file calls are stepped OVER', () => {
    const st = S({
      stepMode: 'over', pausedFile: 'main.xc', pausedLine: 83,
      scope: { file: 'main.xc', line: 83, end: 120 },
    });
    // a call into ANOTHER file's body is stepped over (no stop in there)
    expect(stepperLaw([pair(1, 5), pair(1, 60)], undefined, FT, new Map(), st)).toBeNull();
    // the frame returns to OUR file: stop at the caller's next line
    expect(stepperLaw([pair(1, 5), pair(0, 84)], undefined, FT, new Map(), st))
      .toEqual({ file: 'main.xc', line: 84, stepMode: 'off', depth: 0 });
    // the re-stop on the SAME pair (a loop line executing again) is not fresh
    expect(stepperLaw([pair(0, 83)], undefined, FT, new Map(), st)).toBeNull();
    // a loop wrapping to an EARLIER line of our file is a fresh stop
    expect(stepperLaw([pair(0, 40)], undefined, FT, new Map(), st))
      .toEqual({ file: 'main.xc', line: 40, stepMode: 'off', depth: 0 });
  });
  it('over at TOP LEVEL (scope null): same-file fresh pairs stop, callee files step over', () => {
    const st = S({ stepMode: 'over', pausedFile: 'main.xc', pausedLine: 17, scope: null });
    expect(stepperLaw([pair(0, 17)], undefined, FT, new Map(), st)).toBeNull();
    expect(stepperLaw([pair(1, 4)], undefined, FT, new Map(), st)).toBeNull();
    expect(stepperLaw([pair(0, 18)], undefined, FT, new Map(), st))
      .toEqual({ file: 'main.xc', line: 18, stepMode: 'off', depth: 0 });
  });
  // XENON-DEBUG v3 (v1.13.31, workpackages WP4, we: "When I press f10, it
  // steps into, not over a function"): the depth stream makes the SAME-FILE
  // callee law real — a callee body (pausedDepth+1) is stepped OVER.
  it('over + depth (v3): an IN-FILE callee (depth+1) is stepped OVER, the return stops', () => {
    const st = S({ stepMode: 'over', pausedFile: 'main.xc', pausedLine: 10, pausedDepth: 0 });
    // main.xc:10 calls @move (main.xc:41-43); the caller's line 11 follows
    const pairs = [pair(0, 41), pair(0, 42), pair(0, 43), pair(0, 11)];
    const depths = [1, 1, 1, 0];
    expect(stepperLaw(pairs, depths, FT, new Map(), st))
      .toEqual({ file: 'main.xc', line: 11, stepMode: 'off', depth: 0 });
  });
  it('over + depth (v3): from INSIDE a frame the body continues at the same depth; a nested call is stepped over; the return into the caller (depth-1, same file) stops', () => {
    const st = S({ stepMode: 'over', pausedFile: 'main.xc', pausedLine: 42, pausedDepth: 1 });
    // @move body line 43 (depth 1) — the next line at MY frame: a stop
    expect(stepperLaw([pair(0, 43)], [1], FT, new Map(), st))
      .toEqual({ file: 'main.xc', line: 43, stepMode: 'off', depth: 1 });
    // a nested call (depth 2) is stepped over; the return lands at the
    // caller (depth 0, same file) — a stop there too
    expect(stepperLaw([pair(0, 90), pair(0, 91), pair(0, 12)], [2, 2, 0], FT, new Map(), st))
      .toEqual({ file: 'main.xc', line: 12, stepMode: 'off', depth: 0 });
  });
  it('over + depth (v3): a missing depths array degrades to the file-only law (older wasm)', () => {
    const st = S({ stepMode: 'over', pausedFile: 'main.xc', pausedLine: 10, pausedDepth: 0 });
    expect(stepperLaw([pair(0, 41)], [], FT, new Map(), st))
      .toEqual({ file: 'main.xc', line: 41, stepMode: 'off', depth: 0 });
  });
  it('breakpoints report the pair depth (the next pause updates pausedDepth)', () => {
    const breaks = new Map([['main.xc', new Set([42])]]);
    expect(stepperLaw([pair(0, 42)], [2], FT, breaks, S()))
      .toEqual({ file: 'main.xc', line: 42, stepMode: 'off', depth: 2 });
  });
});
