// stepper.ts — THE STEPPER LAW, the debugger's stepping model (P10-S2a
// slice: the first runtime seam to join the package — the VS Code DAP
// adapter consumes EXACTLY this). The app pump and the xc_host.cpp EM_JS
// hook are the law's two live sites (THE STEP LAW LIVES IN TWO PLACES —
// AGENTS § Xenon); this file is its canonical, pinned, UI-free form.
//
// The interpreter streams EXECUTION-ORDER pairs: fileIndex·1e6 + line
// (encodePair), XENON-DEBUG v3 adding a parallel CALL-DEPTH stream. The
// law walks the stream for the first stop: breakpoints · run-to · F11
// (into) · F10 (over, depth-aware).

export interface StepperState {
  stepMode: 'off' | 'over' | 'into' | 'to';
  /** where the debugger last stopped (a 'fresh' pair is any pair ≠ it) */
  pausedFile: string; pausedLine: number;
  /** XENON-DEBUG v3: the CALL DEPTH at the pause — step-over stops at the
   *  first fresh pair of the paused file at depth <= this (a callee body
   *  sits at depth+1 and is stepped OVER; the return stops) */
  pausedDepth: number;
  /** runTo target (stepMode 'to') */
  toFile: string; toLine: number;
  /** the enclosing function body (legacy v1.13.16 scope-window law; the
   *  v1.13.28 classic law stopped using it — kept for the SAB slot 7/8
   *  protocol documentation) */
  scope: { file: string; line: number; end: number } | null;
}

export interface StepperHit {
  file: string; line: number; stepMode: StepperState['stepMode'];
  /** XENON-DEBUG v3: the pair's call depth (the next pause's reference) */
  depth: number;
}

/** the pair-stream encoding: fileIndex · 1e6 + line (1-based) */
export const encodePair = (fileIndex: number, line: number) => fileIndex * 1_000_000 + line;
export const pairFileIndex = (p: number) => Math.floor(p / 1_000_000);
export const pairLine = (p: number) => p % 1_000_000;

export function stepperLaw(pairs: number[], depths: number[] | undefined,
  fileTable: string[], breaks: Map<string, Set<number>>, st: StepperState): StepperHit | null {
  if (!pairs.length || (st.stepMode === 'off' && !breaks.size)) return null;
  const dep = depths && depths.length === pairs.length ? depths : null;
  for (let k = 0; k < pairs.length; k++) {
    const p = pairs[k]!;
    const idx = pairFileIndex(p);
    const file = fileTable[idx] ?? `#${idx}`;
    const line = pairLine(p);
    const depth = dep ? dep[k]! : 0;
    // breakpoints pause WITHOUT clearing the step mode (an armed F10
    // survives a breakpoint stop — the v1.13.16 stream walk)
    if (breaks.get(file)?.has(line)) return { file, line, stepMode: st.stepMode, depth };
    if (st.stepMode === 'to' && file === st.toFile && line === st.toLine)
      return { file, line, stepMode: 'off', depth };
    const fresh = !(file === st.pausedFile && line === st.pausedLine);
    if (st.stepMode === 'into' && fresh) return { file, line, stepMode: 'off', depth };
    if (st.stepMode === 'over' && fresh && file === st.pausedFile
        && depth <= (st.pausedDepth | 0)) {
      // v1.13.31 CLASSIC STEP-OVER DEEPENED (we: "When I press f10, it
      // steps into, not over a function"): the v1.13.28 file-only rule
      // landed inside SAME-FILE callees (the pair stream had no call
      // depth). XENON-DEBUG v3 carries the depth: stop at the first fresh
      // pair of the paused file at depth <= the paused depth — a callee
      // (depth+1) is stepped over, the frame's return (depth-1, same
      // file) resumes as a stop. xc_host.cpp's EM_JS hook carries the
      // TWIN (THE STEP LAW LIVES IN TWO PLACES).
      return { file, line, stepMode: 'off', depth };
    }
  }
  return null;
}
