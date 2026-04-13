import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  PipelineProfiler,
  NoopProfiler,
  formatProfileSummary,
} from '../../src/utils/profiler.js';

describe('PipelineProfiler', () => {
  let profiler: PipelineProfiler;

  beforeEach(() => {
    profiler = new PipelineProfiler();
  });

  it('records wall time between begin() and end()', () => {
    profiler.begin();
    profiler.end();
    const summary = profiler.summarize();
    expect(summary.wallMs).toBeGreaterThanOrEqual(0);
  });

  it('records a single phase timing', async () => {
    profiler.begin();
    const end = profiler.start('test-phase');
    await sleep(10);
    end();
    profiler.end();

    const summary = profiler.summarize();
    const phase = summary.phases.get('test-phase');
    expect(phase).toBeDefined();
    expect(phase!.count).toBe(1);
    expect(phase!.totalMs).toBeGreaterThanOrEqual(5);
    expect(phase!.minMs).toBe(phase!.totalMs);
    expect(phase!.maxMs).toBe(phase!.totalMs);
    expect(phase!.meanMs).toBe(phase!.totalMs);
  });

  it('aggregates multiple recordings of the same phase', async () => {
    profiler.begin();

    const end1 = profiler.start('metadata');
    await sleep(5);
    end1();

    const end2 = profiler.start('metadata');
    await sleep(15);
    end2();

    profiler.end();

    const summary = profiler.summarize();
    const phase = summary.phases.get('metadata');
    expect(phase).toBeDefined();
    expect(phase!.count).toBe(2);
    expect(phase!.totalMs).toBeGreaterThanOrEqual(15);
    expect(phase!.minMs).toBeLessThanOrEqual(phase!.maxMs);
    expect(phase!.meanMs).toBeCloseTo(phase!.totalMs / 2, -1);
  });

  it('tracks multiple distinct phases', () => {
    profiler.begin();

    const endA = profiler.start('phase-a');
    endA();
    const endB = profiler.start('phase-b');
    endB();

    profiler.end();

    const summary = profiler.summarize();
    expect(summary.phases.size).toBe(2);
    expect(summary.phases.has('phase-a')).toBe(true);
    expect(summary.phases.has('phase-b')).toBe(true);
  });

  it('sorts phases by total time descending', async () => {
    profiler.begin();

    const endFast = profiler.start('fast');
    endFast();

    const endSlow = profiler.start('slow');
    await sleep(10);
    endSlow();

    profiler.end();

    const summary = profiler.summarize();
    const keys = [...summary.phases.keys()];
    expect(keys[0]).toBe('slow');
    expect(keys[1]).toBe('fast');
  });

  it('resets all data', () => {
    profiler.begin();
    const end = profiler.start('x');
    end();
    profiler.end();

    profiler.reset();
    const summary = profiler.summarize();
    expect(summary.wallMs).toBe(0);
    expect(summary.phases.size).toBe(0);
  });

  it('returns empty phases when nothing was recorded', () => {
    profiler.begin();
    profiler.end();
    const summary = profiler.summarize();
    expect(summary.phases.size).toBe(0);
  });
});

describe('NoopProfiler', () => {
  it('start() returns a callable noop', () => {
    const profiler = new NoopProfiler();
    profiler.begin();
    const end = profiler.start('anything');
    expect(typeof end).toBe('function');
    end();
    profiler.end();

    const summary = profiler.summarize();
    expect(summary.wallMs).toBe(0);
    expect(summary.phases.size).toBe(0);
  });

  it('all returned noop functions are the same reference', () => {
    const profiler = new NoopProfiler();
    const a = profiler.start('a');
    const b = profiler.start('b');
    expect(a).toBe(b);
  });
});

describe('formatProfileSummary', () => {
  it('formats an empty summary', () => {
    const output = formatProfileSummary({ wallMs: 0, phases: new Map() });
    expect(output).toContain('Pipeline wall time');
    expect(output).toContain('No profiling data recorded');
  });

  it('formats a summary with phases', () => {
    const phases = new Map([
      ['thumbnails', { count: 100, totalMs: 5000, minMs: 20, maxMs: 200, meanMs: 50 }],
      ['metadata', { count: 100, totalMs: 3000, minMs: 10, maxMs: 150, meanMs: 30 }],
    ]);
    const output = formatProfileSummary({ wallMs: 10000, phases });
    expect(output).toContain('10.00s');
    expect(output).toContain('thumbnails');
    expect(output).toContain('metadata');
    expect(output).toContain('Phase');
    expect(output).toContain('Count');
    expect(output).toContain('Total');
    expect(output).toContain('Mean');
    expect(output).toContain('Min');
    expect(output).toContain('Max');
  });

  it('formats milliseconds below 1s without "s" suffix', () => {
    const phases = new Map([
      ['fast', { count: 1, totalMs: 50, minMs: 50, maxMs: 50, meanMs: 50 }],
    ]);
    const output = formatProfileSummary({ wallMs: 100, phases });
    expect(output).toContain('50.0ms');
  });

  it('formats large durations with "s" suffix', () => {
    const phases = new Map([
      ['slow', { count: 1, totalMs: 2500, minMs: 2500, maxMs: 2500, meanMs: 2500 }],
    ]);
    const output = formatProfileSummary({ wallMs: 3000, phases });
    expect(output).toContain('2.50s');
  });
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
