import { performance } from 'node:perf_hooks';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PhaseStats {
  /** Number of times this phase was recorded. */
  count: number;
  /** Total wall-clock time in milliseconds. */
  totalMs: number;
  /** Minimum duration in milliseconds. */
  minMs: number;
  /** Maximum duration in milliseconds. */
  maxMs: number;
  /** Mean duration in milliseconds. */
  meanMs: number;
}

export interface ProfileSummary {
  /** Total wall-clock time from start to finish in milliseconds. */
  wallMs: number;
  /** Per-phase aggregate statistics, ordered by total time descending. */
  phases: Map<string, PhaseStats>;
}

// ---------------------------------------------------------------------------
// PipelineProfiler
// ---------------------------------------------------------------------------

/**
 * Lightweight profiler for collecting per-phase timing data across many
 * iterations of an indexing pipeline. Designed to be passed into hot loops
 * and called with minimal overhead when disabled.
 *
 * Usage:
 *   const profiler = new PipelineProfiler();
 *   const end = profiler.start('metadata');
 *   await doWork();
 *   end();
 *   const summary = profiler.summarize();
 */
export class PipelineProfiler {
  private readonly entries = new Map<string, number[]>();
  private startTime = 0;
  private endTime = 0;

  /** Mark the beginning of the overall pipeline run. */
  begin(): void {
    this.startTime = performance.now();
  }

  /**
   * Start timing a named phase. Returns a function that, when called,
   * records the elapsed time for that phase.
   */
  start(phase: string): () => void {
    const t0 = performance.now();
    return () => {
      const elapsed = performance.now() - t0;
      let bucket = this.entries.get(phase);
      if (!bucket) {
        bucket = [];
        this.entries.set(phase, bucket);
      }
      bucket.push(elapsed);
    };
  }

  /** Mark the end of the overall pipeline run. */
  end(): void {
    this.endTime = performance.now();
  }

  /** Compute aggregate statistics for all recorded phases. */
  summarize(): ProfileSummary {
    const phases = new Map<string, PhaseStats>();

    for (const [phase, durations] of this.entries) {
      const count = durations.length;
      let totalMs = 0;
      let minMs = Infinity;
      let maxMs = -Infinity;

      for (const d of durations) {
        totalMs += d;
        if (d < minMs) minMs = d;
        if (d > maxMs) maxMs = d;
      }

      phases.set(phase, {
        count,
        totalMs,
        minMs: count > 0 ? minMs : 0,
        maxMs: count > 0 ? maxMs : 0,
        meanMs: count > 0 ? totalMs / count : 0,
      });
    }

    // Sort by total time descending
    const sorted = new Map(
      [...phases.entries()].sort((a, b) => b[1].totalMs - a[1].totalMs),
    );

    return {
      wallMs: this.endTime - this.startTime,
      phases: sorted,
    };
  }

  /** Reset all recorded data. */
  reset(): void {
    this.entries.clear();
    this.startTime = 0;
    this.endTime = 0;
  }
}

// ---------------------------------------------------------------------------
// NoopProfiler
// ---------------------------------------------------------------------------

const NOOP = () => {};

/**
 * A profiler that does nothing — used when profiling is disabled so that
 * call sites don't need conditional checks.
 */
export class NoopProfiler extends PipelineProfiler {
  override begin(): void {}
  override start(_phase: string): () => void {
    return NOOP;
  }
  override end(): void {}
  override summarize(): ProfileSummary {
    return { wallMs: 0, phases: new Map() };
  }
  override reset(): void {}
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function fmtMs(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  return `${ms.toFixed(1)}ms`;
}

function padLeft(s: string, width: number): string {
  return s.padStart(width);
}

function padRight(s: string, width: number): string {
  return s.padEnd(width);
}

/**
 * Format a profile summary as a human-readable table suitable for CLI output.
 */
export function formatProfileSummary(summary: ProfileSummary): string {
  const lines: string[] = [];

  lines.push(`Pipeline wall time: ${fmtMs(summary.wallMs)}`);
  lines.push('');

  if (summary.phases.size === 0) {
    lines.push('No profiling data recorded.');
    return lines.join('\n');
  }

  const header = [
    padRight('Phase', 24),
    padLeft('Count', 7),
    padLeft('Total', 10),
    padLeft('Mean', 10),
    padLeft('Min', 10),
    padLeft('Max', 10),
  ].join('  ');

  lines.push(header);
  lines.push('─'.repeat(header.length));

  for (const [phase, stats] of summary.phases) {
    lines.push(
      [
        padRight(phase, 24),
        padLeft(String(stats.count), 7),
        padLeft(fmtMs(stats.totalMs), 10),
        padLeft(fmtMs(stats.meanMs), 10),
        padLeft(fmtMs(stats.minMs), 10),
        padLeft(fmtMs(stats.maxMs), 10),
      ].join('  '),
    );
  }

  return lines.join('\n');
}
