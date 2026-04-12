# ADR-010: Async Concurrency Limiter (p-limit) Instead of Worker Threads

## Status
Accepted

## Context
The Java version uses thread pools (`ThreadPool`) for CPU-intensive work: file indexing, hash matching, and face matching, all sized based on CPU count. Node.js is single-threaded, so we need a concurrency strategy.

Options considered:
1. **Worker thread pool** (Piscina or Tinypool) — dedicated threads for CPU-bound tasks
2. **Async concurrency limiter** (p-limit) — control how many async operations run simultaneously
3. **Custom worker pool** — roll our own with `worker_threads`

## Decision
We will use **p-limit** as an async concurrency limiter.

## Rationale
The CPU-intensive work in this application happens in native code that already manages its own threading:
- **sharp (libvips)** — maintains a thread pool (default 4 threads) for image operations
- **onnxruntime-node** — runs inference in native C++ threads
- **SQLite** — I/O handled by the OS

The JavaScript main thread handles lightweight orchestration: reading config, constructing queries, routing HTTP requests. The JS-on-main-thread portion of file indexing is minimal (~1ms of glue code between native operations).

Worker threads would add:
- Complexity (serializing data between threads, managing the pool)
- Memory overhead (each worker loads its own copy of modules)
- Marginal performance benefit since the bottleneck is native code that's already multi-threaded

p-limit controls how many files are processed concurrently (default: CPU count), preventing memory exhaustion from loading too many images simultaneously while letting sharp and onnxruntime saturate CPU cores internally.

## Tradeoffs
- If profiling reveals the JS glue code is a bottleneck (unlikely), worker threads can be introduced later without restructuring the application
- p-limit doesn't provide true parallelism for JS code — but we don't need it since our JS code is I/O-bound orchestration
