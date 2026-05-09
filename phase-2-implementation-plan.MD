## Phase 2 Implementation Order — Hardening

Phase 2 adds lease renewal, AbortSignal injection, retry logic, `leaderOnly` flag, and graceful shutdown. It assumes Phase 1 core (lock/unlock, basic cron wrapper) is complete and tested.

---

### Task 2.1: Lease renewal in `LeaderElector`

**Build:**
- Add `renewLock(jobName: string, ttlMs: number): Promise<boolean>` to `LeaderElector` that loads and executes `renew.lua` using Redis EVAL.
- Add private map `activeIntervals: Map<string, NodeJS.Timeout>` to track renewal intervals.
- Add method `startRenewalLoop(jobName: string, ttlMs: number, onFailure: () => void): void`:
  - Creates a `setInterval` at the configured `renewInterval` (from module config).
  - Keeps a failure counter; when `renewLock` returns `false` (lock no longer owned) or an error occurs, increment counter. If counter >= `maxRenewFailures`, call `onFailure` and clear interval.
  - On success, reset counter and extend the lock.
- Add `stopRenewalLoop(jobName: string): void` to clear the interval.

**Test:**
- **Unit:** Mock ioredis to verify `renew.lua` is invoked with correct keys and args. Test that `renewLock` returns `true` when Redis returns 1 (success) and `false` on 0 (ownership lost).
- **Integration (real Redis):** Acquire a lock with short TTL (e.g., 2s), call `startRenewalLoop` with 500ms interval, check that `PTTL` stays above initial TTL - 1s for at least 5s. Stop loop, ensure lock expires normally.

**Unblocks:** `CronSchedulerService` can now call the renewal loop around long-running jobs.

---

### Task 2.2: Integrate renewal into cron wrapper

**Build:**
- In `CronSchedulerService`’s wrapper generation:
  - After successfully acquiring lock (`acquireLock` → `true`), before executing the original method, call `leaderElector.startRenewalLoop(jobName, ttl, abortHandler)` if `autoRenew` option is not `false`.
  - The `abortHandler` will be a callback that calls `AbortController.abort()` (implementation in next task).
  - Modify the wrapper to have a `try/catch/finally` structure:
    - `finally` block ensures `leaderElector.stopRenewalLoop(jobName)` and `releaseLock(jobName)` are called.
  - The wrapper currently handles `acquireLock` → execute → release. The renewal loop must start **after** lock acquisition and before execution.

**Test:**
- **Unit:** Mock `LeaderElector.startRenewalLoop` and verify it is called with correct parameters and that `stopRenewalLoop` is called in `finally`. Use a test provider with a long-running method (a Promise that never resolves, then timed out) to see the loop lifecycle.
- **Integration:** Create a real cron job that sleeps 10 seconds with `leaseDuration: 5_000`, `autoRenew: true`, `renewInterval: 1_500`. Run one instance; the job should complete without interruption. Observe via Redis `PTTL` that the lock TTL never drops below ~3.5s. Kill the instance mid-job; a second instance should acquire the lock after the original TTL expires (since renewal stops).

**Unblocks:** The cron wrapper now supports jobs that exceed the initial lock TTL. This makes the system safe for any job duration.

---

### Task 2.3: AbortSignal injection via `@DistributedCronAbort()`

**Build:**
- In `CronSchedulerService`, for each invocation of a decorated method, create a new `AbortController`.
- Retrieve the parameter index stored by `@DistributedCronAbort` metadata (from Task 4, Phase 1).
- If the parameter decorator is present, inject `controller.signal` into the method arguments at that index before calling the original method.
- Pass `() => controller.abort()` as the `onFailure` callback to `startRenewalLoop` (so that repeated renewal failures trigger an abort).
- The method can check `signal.aborted` or listen to `"abort"` to stop early.

**Test:**
- **Unit:** Provide a test service method with a `(signal: AbortSignal)` parameter decorated with `@DistributedCronAbort()`. Verify that the wrapper passes the signal and that after calling `controller.abort()` (simulated), the signal state becomes aborted.
- **Integration:** Run a job that loops forever, checking `signal.aborted` every iteration. After a few seconds, make Redis unreachable (e.g., stop the container). The renewal loop should fail `maxRenewFailures` times, abort the signal, and the job should break out of its loop. The lock is **not** explicitly released (since Redis is down), but eventually expires. Verify the abort signal is triggered.

**Unblocks:** Developers can gracefully stop long-running work when leadership is lost, preventing zombie processing.

---

### Task 2.4: Retry on failure with exponential backoff

**Build:**
- Extend the `DistributedCronOptions` with optional `retry` sub-options (or use `retryOnFailure: true` with sensible defaults: `maxRetries=3`, `baseDelay=100` ms, `factor=2`). For v1, just `retryOnFailure: boolean` with hardcoded values.
- Modify the wrapper: after acquiring the lock, wrap the original method invocation in a retry loop:
  - On method failure (throw), if `retryOnFailure` is true, wait for `baseDelay * (factor ^ (attempt-1))` ms and try again while still holding the lock and renewing.
  - If all retries exhausted, rethrow the last error.
  - If the job succeeds, exit normally.
- The renewal loop continues during the wait periods, so the instance remains the leader.

**Test:**
- **Unit:** Mock a method that throws on first two calls, succeeds on third. Verify that the wrapper calls it exactly three times, with proper delays (use fake timers). Also verify that `releaseLock` and `stopRenewal` happen only once after final success.
- **Integration:** With a real Redis, create a job that throws an exception. Observe retry attempts in logs and that the lock is finally released. Ensure no duplicate execution from another instance during retries (since lock is held).

**Unblocks:** Transient errors (DB hiccups, network timeouts) won't abort the entire cron job.

---

### Task 2.5: `leaderOnly` flag implementation

**Build:**
- In the wrapper, check the `leaderOnly` option (default `true`).
- If `leaderOnly === false`:
  - Still try `acquireLock` (for observability/metrics) but ignore the result.  
  - Always execute the original method, regardless of whether this instance is the leader.
  - Still run renewal loop and use abort signals as normal (so it behaves like a non‑exclusive cron but with leader election info available).
- This allows developers to temporarily opt out of distributed enforcement for local development or testing.

**Test:**
- **Unit:** With two instances (simulated in the same process) and `leaderOnly: false`, verify that both instances execute the method even though only one holds the lock. With `leaderOnly: true`, only the lock holder runs.
- **Integration:** Two real processes with `leaderOnly: false` both log on the same cron tick, while setting to `true` shows only one.

**Unblocks:** Developer ergonomics – no need to change module config to test locally.

---

### Task 2.6: Graceful shutdown

**Build:**
- Implement `OnApplicationShutdown` (or `beforeApplicationShutdown`) in `LeaderElector` or a dedicated `ShutdownService`.
- In the hook:
  - Iterate over all active renewal intervals (map) and clear them.
  - For each known job lock currently held by this instance (tracked via a set), call `releaseLock` via the safe Lua script.
  - Finally, disconnect the Redis client gracefully.
- In `CronSchedulerService`, ensure that when the module is shutting down, no new cron cycles will attempt to acquire locks (the `SchedulerRegistry` automatically stops cron jobs when the app shuts down, but we must ensure in‑flight jobs are interrupted).
- For extra safety, immediately abort all active `AbortController`s (stored) to stop any running methods.

**Test:**
- **Unit:** Trigger shutdown via Nest lifecycle; verify that intervals are cleared, release is called, and Redis quits.
- **Integration:** Run a long‑running cron job, then send `SIGTERM` to the process. After shutdown, check Redis that the lock key is gone (or quickly expiring). A second instance should acquire the lock on the next tick without waiting for full TTL.

**Unblocks:** The package is now production‑safe – restarts or pod evictions won’t leave dangling locks.

---

### Task 2.7: Phase 2 comprehensive unit‑test sweep

**Build:**
- Fill coverage gaps from Tasks 2.1–2.6. Every new public method, edge case (maxRenewFailures exceeded, retry exhaustion, shutdown while retrying), and error path must have a test.
- Ensure coverage meets Phase 2 targets (≥90% lines, ≥85% branches for the entire `src/`).

**Test:**
- Run `npm test` and confirm all unit tests pass with coverage report meeting thresholds.
- Run `npm run test:int` and `npm run test:e2e` (if any E2E tests added) to validate integration scenarios.

**Unblocks:** Confidence that hardening is complete; readiness to move to Phase 3 (Observability).