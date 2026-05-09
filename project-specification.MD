```markdown
# Project Specification: `nestjs-distributed-cron`

> **Distributed singleton cron scheduler with Redis-backed leader election for NestJS**

---

## 1. Project Overview

`nestjs-distributed-cron` is a NestJS-first package that augments `@nestjs/schedule` with distributed leader election using Redis. It provides a drop‑in replacement for the familiar `@Cron()` decorator, guaranteeing that a scheduled job runs on **exactly one** instance, even when your application is scaled to dozens of pods. The package delivers automatic lease acquisition, TTL‑based health monitoring, background renewal for long‑running jobs, and built‑in observability—all without leaving the NestJS paradigm.

**One‑line pitch:**  
*Run `@Cron()` in a cluster, protect side‑effects from duplication, and get production‑grade leader election out of the box.*

**Who it is for:**  
Backend teams deploying NestJS on Kubernetes, ECS, or any horizontally‑scaling platform where multiple replicas would otherwise fire the same scheduled job simultaneously.

**Badges (placeholders):**  
[![npm version](https://img.shields.io/npm/v/@mohamedsaba/nestjs-distributed-cron)](https://www.npmjs.com/package/@mohamedsaba/nestjs-distributed-cron) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE) [![Build Status](https://img.shields.io/github/actions/workflow/status/mohamedsaba/nestjs-distributed-cron/ci.yml?branch=main)](https://github.com/mohamedsaba/nestjs-distributed-cron/actions)

---

## 2. The Real-World Problem

### 2.1 Production failure scenario

A NestJS application runs 3 Kubernetes pods. One service class contains a daily email report job:

```typescript
@Injectable()
class ReportService {
  @Cron('0 8 * * *')
  async sendReport() {
    // aggregate data, generate PDF, send email
  }
}
```

At 08:00 UTC, **every pod** triggers the method simultaneously. Three emails are dispatched, identical invoices are created, and data aggregations clobber each other. The team scrambles to add a Redis lock before the next recurrence—doing everything from ad‑hoc `SET NX` commands to copying a bespoke locking library between projects.

### 2.2 Why existing solutions fail

| Solution | What it does | Limitation |
|---|---|---|
| `@nestjs/schedule` | Declarative cron decorators | No coordination; every instance fires independently |
| `nestjs-redis-lock` | Generic `@RedisLock()` decorator | Requires manual key naming, TTL management, and heartbeats. No cron‑specific lifecycle, no observability. |
| `nest-leader-election` | PostgreSQL‑backed leader election | Ties you to a relational DB; unsuitable for lightweight cron tasks. |
| `@fxdigital/nestjs-leader-election` | Quasi‑Raft consensus over Redis | Heavyweight protocol; designed for full microservice leadership, not single‑job scheduling. |
| `schedule-event-mongo` | MongoDB‑backed singleton events | Immature (low adoption), forces MongoDB, no NestJS decorator model. |
| `@softkit/jobs` | BullMQ wrapper with Redlock | Requires re‑architecting everything as queue producers/consumers; abandons the `@Cron()` decorator. |
| `nestjs-k8s-leader-election` | Kubernetes lease API | K8s‑only; does not work on ECS, bare metal, or any non‑K8s deployment. |

### 2.3 Cost of the problem

- **Developer time**: Every team reinvents leader election, typically spending 2–5 days per project on locking boilerplate, testing, and debugging edge cases (split‑brain, GC pauses).
- **Reliability**: Home‑grown solutions often miss renewal logic, leading to duplicate execution under network partitions. One missed lock can cause duplicate financial transactions or customer‑facing spam.
- **User impact**: Duplicate emails, double charges, conflicting data updates erode trust and create support workload.

---

## 3. The Solution

### 3.1 Step‑by‑step resolution

1. **Module registration**: `DistributedCronModule.forRoot({ redis, leaseDuration: 15_000, instanceId: "pod-xyz" })` initialises a Redis connection and the `LeaderElector` service.
2. **Decorator replacement**: The method adorned with `@DistributedCron('0 8 * * *', { name: 'report' })` is wrapped at startup.
3. **Cron trigger**: The package registers the schedule via `@nestjs/schedule`’s `SchedulerRegistry`. At the scheduled time, the wrapper runs:
   - Consults the `LeaderElector` to **acquire** the lock for the job `'report'`.
   - If successful (I’m the leader), execute the original method.
   - If the method runs longer than the lease TTL, a background heartbeat **renews** the lease.
   - On completion (or failure), the lock is **released**.
4. **Failover**: If the leader pod dies or Redis becomes unreachable, the lock TTL expires naturally. The next cron tick from another instance will successfully acquire the lock and take over.
5. **Observability**: A health endpoint and Prometheus metrics are exposed, compatible with `bullmq-metrics`.

### 3.2 Architecture overview (ASCII diagram)

```
  Pod A             Pod B             Pod C
    |                 |                 |
    | Cron tick       | Cron tick       | Cron tick
    | 8:00:00.000     | 8:00:00.000     | 8:00:00.000
    |                 |                 |
    | SET NX PX lock  |                 |
    | OK (leader)     | SET NX PX lock  |
    |                 | → fail (already |
    |                 |    held)        | SET NX PX lock
    | [execute job]   |                 | → fail
    | ...renew loop...|                 |
    | ...job done...  |                 |
    | DEL lock        |                 |
    |                 |                 |
    |                 | Next tick (if   |
    |                 | pod A dead)     |
    |                 | SET NX PX lock  |
    |                 | OK → new leader |
```

### 3.3 “Exactly once” guarantees and limits

- **Guarantee**: At **most one** instance will execute the function per scheduled tick under normal operation (no byzantine failures). This is implemented via atomic `SET NX PX` and a Lua‑based renewal that verifies the holder’s identity.
- **Not a transactional exactly‑once**: If a leader dies mid‑execution and the lock expires before the next renewal, another instance may acquire the lock and re‑execute the job. This is a **stale‑leader** scenario. Combined with `nestjs-idempotent` on side‑effects, true end‑to‑end idempotency is achieved.
- **Failure modes**: Network partitions that split Redis from all pods can cause lock expiry; the next healthy pod will take over, potentially causing duplicate execution if the original leader was still running. The `AbortSignal` injection helps the original pod stop early if it detects lost leadership.

---

## 4. Package Scope

### 4.1 In scope (v1.0)

- `@DistributedCron()` decorator as a drop‑in replacement for `@Cron()`.
- `LeaderElector` injectable service for explicit leadership checks.
- Redis‑backed lock acquisition with `SET NX PX` (millisecond‑precision TTL).
- Lua‑scripted lock renewal that only the current holder can extend.
- **Automatic renewal** for long‑running jobs, with configurable interval.
- **AbortSignal injection** via `@DistributedCronAbort()` parameter decorator to stop execution when leadership is lost.
- **Leader‑only execution** (`leaderOnly: true` by default); set to `false` for basic locking without exclusivity (e.g., local development).
- **Retry on failure** with exponential backoff (`retryOnFailure` option).
- Graceful shutdown: release locks on `SIGTERM`/`SIGINT`.
- Health endpoint at `GET /distributed-cron/health` (automatic registration).
- Optional Prometheus metrics (compatible with `bullmq-metrics`’s registry).
- Configuration via `forRoot` or `forRootAsync` (e.g., with `ConfigModule`).
- `instanceId` defaults to `process.env.POD_NAME` or a UUID.

### 4.2 Out of scope (v1.0)

- **Redlock plugin** (multi‑master Redis). v2 may provide a pluggable lock strategy.
- **Database‑backed leader election** (PostgreSQL, etc.).
- **Kubernetes lease integration** – stick to Redis for portability.
- **Cron job chaining / DAGs** – not a workflow engine.
- **`@Interval()` decoration** – first release focuses on cron expressions only.

### 4.3 Non‑goals

- Replacing `@nestjs/schedule`; we complement it.
- Handling job queuing or custom retry queues (delegate to BullMQ if needed).
- Providing a UI dashboard.

---

## 5. Technical Architecture

### 5.1 Redis data model

For each scheduled job, the package uses a single key:

**Key:** `distributed-cron:{jobName}:lock`  
**Value:** `instanceId` (plain string, e.g., `"pod-abc123"`)  
**TTL:** `leaseDuration` milliseconds (configurable, default 15 000)

The absence of a key means no instance currently holds the lock.

**Leader inspection** (for `getCurrentLeader` / `getLeaseExpiration`):  
The service issues `GET` + `PTTL` to retrieve the current holder’s identity and remaining TTL. Lease expiration timestamp = `Date.now() + pttl`.

### 5.2 Lua scripts

All scripts run atomically on Redis.

#### `renew.lua`

```lua
-- ARGV[1]: instanceId
-- ARGV[2]: newTTL (milliseconds)
-- KEYS[1]: lock key
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("PEXPIRE", KEYS[1], ARGV[2])
else
  return 0
end
```

**Purpose:** Extend the lock’s TTL **only** if the caller still holds the lock. Prevents a pod that thinks it’s the leader from extending after the lock was taken by a new leader (stale‑leader protection).

#### `release.lua`

```lua
-- ARGV[1]: instanceId
-- KEYS[1]: lock key
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
else
  return 0
end
```

**Purpose:** Delete the lock only if it’s still owned by the releasing instance. Prevents accidental deletion of a new leader’s lock.

No Lua script is needed for the initial acquisition—Node.js executes `SET lock_key instanceId NX PX leaseDuration` natively.

### 5.3 Leader election lifecycle

1. **Acquire**  
   When the cron wrapper fires, it calls `acquireLock(jobName)`, which runs `SET NX PX`. If the command returns `"OK"`, the instance becomes the leader for this tick.

2. **Hold**  
   If the method returns before the lease expires, the lock is released via `release.lua`.

3. **Renew**  
   For long‑running methods (duration > `leaseDuration`), a background `setInterval` fires every `renewInterval` ms. Each interval calls `renew.lua` with a fresh TTL. The interval is cleared when the method finishes.

4. **Release**  
   After the wrapped method completes (or errors), the lock is released via `release.lua`. The renewal interval is stopped.

5. **Failover**  
   If the leader process crashes or enters a long GC pause, renewals stop. The lock’s TTL expires naturally. At the next cron tick, another instance will acquire the lock and pick up the work. The `AbortSignal` can be used to stop the original execution earlier if the instance detects lost leadership (e.g., after N consecutive renewal failures).

### 5.4 Lease renewal mechanism and failure handling

- `autoRenew` option (default `true`) enables the renewal loop.
- Renewal interval is `renewInterval` (default `leaseDuration / 3`). This gives three chances before TTL exhaustion under normal latency.
- **Failure policy**: If a renewal fails (e.g., Redis unreachable), a failure counter increments. After `maxRenewFailures` (default `3`) consecutive failures:
  - The `AbortController` associated with the job is `abort()`ed.
  - The job’s method receives an `AbortSignal` (if it was declared via `@DistributedCronAbort()`).
  - The method can gracefully stop resource‑intensive work.
  - The lock is **not** explicitly released (we cannot reach Redis), so it will expire on its own.

### 5.5 AbortSignal injection flow

1. At wrapper creation time, a new `AbortController` is instantiated for each invocation.
2. If the method signature includes a parameter decorated with `@DistributedCronAbort()`, the wrapper passes the controller’s `signal` to that argument.
3. The renew failure handler calls `controller.abort()`.
4. The job’s business logic should periodically check `signal.aborted` or listen to the `"abort"` event to stop early, e.g.:
   ```typescript
   async process(@DistributedCronAbort() signal: AbortSignal) {
     for (const item of items) {
       if (signal.aborted) break;
       await doWork(item);
     }
   }
   ```

### 5.6 Module initialization sequence

1. `DistributedCronModule.forRoot(options)` stores configuration and provides `LeaderElector` service as singleton.
2. During `OnModuleInit`, the `CronSchedulerService` scans all providers:
   - Retrieves metadata set by `@DistributedCron()` via `Reflect.getMetadata(DISTRIBUTED_CRON_KEY)`.
   - For each decorated method, it saves the method reference, cron expression, job name, and options.
3. Using `SchedulerRegistry` from `@nestjs/schedule`, it registers a dynamic cron job that invokes the **wrapper** (not the original method).
4. The wrapper is a proxy that calls `acquireLock` → execute original method → `releaseLock`, with renewal loop managed in between.

No global interceptor is used – this avoids per‑request overhead and keeps the scheduling logic isolated.

### 5.7 Graceful shutdown behavior

- On `beforeApplicationShutdown` (Nest life‑cycle hook), the `LeaderElector`:
  - Stops all active renewal intervals.
  - Calls `release.lua` for every lock currently held by this instance.
- On `onApplicationShutdown`, the Redis connection is closed.

---

## 6. Folder Structure

```
nestjs-distributed-cron/
├── src/
│   ├── distributed-cron.module.ts          # Main module definition
│   ├── distributed-cron-core.module.ts     # Internal module with providers
│   ├── decorators/
│   │   ├── distributed-cron.decorator.ts   # @DistributedCron() and @DistributedCronAbort()
│   │   └── metadata.constants.ts           # Reflect key constants
│   ├── services/
│   │   ├── leader-elector.service.ts       # Lock acquisition, renewal, release
│   │   ├── cron-scheduler.service.ts       # Wraps methods & registers schedules
│   │   ├── redis-client.provider.ts        # Redis connection factory
│   │   └── abort-manager.service.ts        # Manages AbortControllers per job
│   ├── lua/
│   │   ├── renew.lua                       # Renewal script
│   │   └── release.lua                     # Safe release script
│   ├── health/
│   │   └── health.controller.ts            # GET /distributed-cron/health
│   ├── metrics/
│   │   └── cron-metrics.service.ts         # Prometheus gauges/counters
│   ├── interfaces/
│   │   ├── distributed-cron-options.interface.ts
│   │   └── leader-elector.interface.ts
│   └── constants/
│       └── default-config.ts               # Default values
├── test/
│   ├── unit/
│   │   ├── leader-elector.service.spec.ts
│   │   ├── cron-scheduler.service.spec.ts
│   │   └── decorators.spec.ts
│   ├── integration/
│   │   ├── leader-election.int-spec.ts     # Multi‑instance simulation
│   │   ├── long-running-job.int-spec.ts
│   │   └── failover.int-spec.ts
│   └── e2e/
│       └── distributed-cron.e2e-spec.ts    # Full NestJS app sequence
├── example/
│   ├── src/
│   │   └── app.module.ts                   # Demo app with sample cron
│   └── docker-compose.yml                  # Redis for local dev
├── package.json
├── tsconfig.json
├── tsconfig.build.json
├── jest.config.ts
├── .eslintrc.js
└── README.md
```

---

## 7. Public API Reference

### 7.1 Exported members

| Export | Type | Description |
|--------|------|-------------|
| `DistributedCronModule` | Dynamic module | Register with `forRoot()` or `forRootAsync()`. |
| `@DistributedCron(cronExpression, options?)` | Method decorator | Marks a method for distributed execution. |
| `@DistributedCronAbort()` | Parameter decorator | Injects `AbortSignal` that is aborted when leadership is lost. |
| `LeaderElector` | Injectable service | Provides leadership state and control. |
| `DistributedCronModuleOptions` | Interface | Configuration shape for `forRoot`. |
| `DistributedCronOptions` | Interface | Per‑job options passed to the decorator. |
| `CronLockAcquisitionError` | Error class | Thrown when lock acquisition fails unexpectedly. |
| `CronLeaseExpiredError` | Error class | Thrown when a job is aborted due to lease expiry. |

### 7.2 `DistributedCronModule.forRoot(options)`

```typescript
interface DistributedCronModuleOptions {
  /**
   * Redis connection options (same shape as ioredis constructor).
   */
  redis: RedisOptions;

  /**
   * Duration (in ms) for which a lock is held before expiring automatically.
   * Must be longer than the expected job duration if autoRenew is false.
   * @default 15_000
   */
  leaseDuration?: number;

  /**
   * Interval (in ms) between lease renewals.
   * @default leaseDuration / 3
   */
  renewInterval?: number;

  /**
   * Identifier for this instance (e.g. pod name).
   * @default process.env.POD_NAME || randomUUID()
   */
  instanceId?: string;

  /**
   * Maximum consecutive renewal failures before aborting the job.
   * @default 3
   */
  maxRenewFailures?: number;

  /**
   * Retry strategy for failed lock acquisitions.
   * Pass a custom `RetryStrategy` or use `true` for exponential backoff.
   * @default false
   */
  retryStrategy?: boolean | RetryStrategy;

  /**
   * If true, automatically register the health endpoint @ /distributed-cron/health.
   * @default true
   */
  enableHealthEndpoint?: boolean;

  /**
   * If true, expose Prometheus metrics (requires `bullmq-metrics`’s registry).
   * @default false
   */
  enableMetrics?: boolean;
}
```

`forRootAsync` mirrors NestJS conventions: `imports`, `useFactory`, `inject`.

### 7.3 `@DistributedCron(cronExpression, options)`

```typescript
interface DistributedCronOptions {
  /**
   * Unique name for this cron job (used as lock key).
   * If omitted, derived from class and method name.
   */
  name?: string;

  /**
   * Maximum expected runtime of the job (ms). Used to set the initial lock TTL
   * and to decide if renewal should occur.
   * @default Inherits module-level leaseDuration
   */
  ttl?: number;

  /**
   * Enable automatic lease renewal for long‑running jobs.
   * @default true
   */
  autoRenew?: boolean;

  /**
   * If true, the method is only executed when this instance is the leader.
   * Set to false for development (still acquires lock but always runs).
   * @default true
   */
  leaderOnly?: boolean;

  /**
   * If true, retry the job on failure with exponential backoff.
   * @default false
   */
  retryOnFailure?: boolean;
}
```

### 7.4 `LeaderElector`

```typescript
class LeaderElector {
  /** Returns true if the current instance holds the lock for 'jobName'. */
  amILeader(jobName: string): Promise<boolean>;

  /** Returns the instanceId of the current leader for 'jobName', or null. */
  getCurrentLeader(jobName: string): Promise<string | null>;

  /** Returns the expiration timestamp (ms) of the current lock, or null. */
  getLeaseExpiration(jobName: string): Promise<number | null>;

  /** Manually release the lock for 'jobName' (only if held by this instance). */
  releaseLock(jobName: string): Promise<void>;
}
```

### 7.5 Error classes

- `CronLockAcquisitionError` – thrown when `acquireLock` fails unexpectedly (e.g., Redis command error, not a normal miss).
- `CronLeaseExpiredError` – thrown inside the job if the `AbortSignal` fires and the method attempts a blocked operation that checks the signal. Developers can catch it to clean up.

---

## 8. Integration with Existing Packages

### 8.1 `nestjs-idempotent`

Combine with `@Idempotent()` to ensure at‑most‑once semantics even if duplicate executions happen (e.g., due to failover).

```typescript
@DistributedCron('0 8 * * *', { name: 'daily-report' })
@Idempotent({ key: 'daily-report', ttl: 86_400_000 }) // 24h idempotency window
async generateReport() { ... }
```

### 8.2 `airlock` (transactional outbox)

When a cron job needs to emit domain events atomically with database writes:

```typescript
@DistributedCron('0 * * * *', { name: 'housekeeping' })
async housekeeping() {
  await this.airlock.transaction(async (trx) => {
    await this.repo.deleteOldData(trx);
    await this.airlock.emit(trx, 'housekeeping-completed', {});
  });
}
```

`airlock` guarantees that the event is published exactly once, and the cron package ensures the entire block is run only once across the cluster.

### 8.3 `bullmq-metrics`

Metrics are pushed to the same Prometheus registry if the app already depends on `bullmq-metrics`.

```typescript
// In your main.ts or AppModule, enable metrics:
DistributedCronModule.forRoot({ redis, enableMetrics: true })
```

This registers:
- `cron_lock_acquisition_total` (counter, labels: `job`, `status`)
- `cron_leader_lease_seconds` (gauge, labels: `job`)
- `cron_job_duration_seconds` (histogram, labels: `job`)

The package uses the `PrometheusMetricsRegistry` interface defined by `bullmq-metrics` and auto‑discovers it.

---

## 9. Requirements

| Requirement | Version / Details |
|-------------|-------------------|
| Node.js | ≥ 16 (LTS) |
| NestJS | ≥ 9 (stable `@nestjs/schedule`) |
| Redis | ≥ 5 (supports `SET NX PX` and Lua `PEXPIRE`) |
| `@nestjs/common` | ≥ 9 (peer dependency) |
| `@nestjs/core` | ≥ 9 (peer dependency) |
| `@nestjs/schedule` | ≥ 2 (peer dependency – uses `SchedulerRegistry`) |
| `ioredis` | ≥ 5 (peer dependency – actual Redis client) |
| `bullmq-metrics` | optional – for Prometheus integration |
| Docker | (dev only) for running Redis locally |

**Environment variables:**
- `POD_NAME` – default `instanceId` if not provided in config (K8s `metadata.name`).
- `REDIS_URL` – alternative to `redis` config option if `forRootAsync` is used with env‑based config.

---

## 10. Development Setup

### 10.1 Clone and install

```bash
git clone https://github.com/mohamedsaba/nestjs-distributed-cron
cd nestjs-distributed-cron
npm install
```

### 10.2 Start Redis locally

```bash
docker run -d --name redis-cron -p 6379:6379 redis:7-alpine
```

### 10.3 Run the example application

```bash
cd example
npm install
npm run start:dev
```

The example includes a cron job named `sample-job` that logs a message every 2 minutes. You can scale it:

```bash
# In another terminal, run a second instance
POD_NAME=instance-2 npm run start:dev
```

Observe that only one instance prints the execution log each tick.

### 10.4 Run tests

```bash
# unit tests
npm test

# integration tests (requires Redis)
npm run test:int

# e2e
npm run test:e2e
```

---

## 11. Testing Strategy

### 11.1 Unit tests

All services are tested with mocked Redis (no external dependency).

| Test file | Key test cases |
|-----------|----------------|
| `leader-elector.service.spec.ts` | – `acquireLock` returns true on first call, false on second<br>– `renewLock` returns true only when caller is holder<br>– `releaseLock` deletes only when holder<br>– `amILeader`/`getCurrentLeader` work correctly |
| `cron-scheduler.service.spec.ts` | – Decorator metadata is read and methods wrapped<br>– Wrapper acquires lock before executing original method<br>– Wrapper releases lock after execution<br>– Auto‑renew loop starts and stops correctly<br>– `AbortController` is linked to parameter decorator<br>– Retry logic triggers on failure |
| `decorators.spec.ts` | – `@DistributedCron()` sets correct metadata<br>– `@DistributedCronAbort()` parameter index is stored |

### 11.2 Integration tests

Integration tests run against a real Redis instance (Dockerised in CI). They simulate multiple instances using concurrent processes or worker threads.

**Multi‑instance simulation:**  
We launch multiple `NestFactory.create` apps in the same Node process, each with a different `instanceId` and the same Redis config. They compete for the same lock.

| Test file | Scenarios |
|-----------|-----------|
| `leader-election.int-spec.ts` | – Only one instance acquires lock on simultaneous trigger<br>– After lock release, next instance acquires |
| `long-running-job.int-spec.ts` | – Job that sleeps longer than lease duration stays leader due to auto‑renew<br>– When renewal fails (Redis stopped), job receives AbortSignal |
| `failover.int-spec.ts` | – Kill leader process mid‑job; other instance acquires after TTL expiry<br>– Verify no double execution if lock was already released |

### 11.3 E2E tests

A single NestJS app boots with `DistributedCronModule` and a test controller. We use `supertest` to assert the health endpoint and manually trigger cron ticks via `SchedulerRegistry` to observe leadership behavior without waiting for real time.

### 11.4 Leader failover test procedure

1. Start two apps (appA, appB) with a 5‑second TTL.
2. AppA acquires lock for job `fail-test`.
3. Pause appA process (or simulate crash).
4. Wait for TTL expiry.
5. Trigger the tick in appB; assert it acquires lock and executes the job.
6. Resume appA; it must not re‑acquire stale lock (AbortSignal fires on renewal failure).

### 11.5 Test tooling

- Jest with `ts-jest`.
- `ioredis-mock` for unit tests (or a custom mock).
- `testcontainers` for spinning up Redis in integration/e2e.
- CI pipeline runs Redis via `docker-compose` service.

### 11.6 Coverage targets

- Line coverage: ≥ 90%
- Branch coverage: ≥ 85%
- All public API methods must be covered.

---

## 12. Build and Release

### 12.1 TypeScript configuration

`tsconfig.build.json`:
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "outDir": "./dist",
    "declaration": true,
    "sourceMap": true,`
    "removeComments": false
  },
  "include": ["src"],
  "exclude": ["node_modules", "test", "dist", "example"]
}
```

`tsconfig.json` targets ES2019, uses strict mode.

### 12.2 Build pipeline

- `npm run build` compiles via `tsc -p tsconfig.build.json`.
- `npm run lint` uses ESLint with `@nestjs/eslint-config`.
- GitHub Actions runs lint → unit tests → integration tests on every push.
- Semantic release via `semantic-release` with `@semantic-release/npm` and `@semantic-release/changelog` publishes to npm.

### 12.3 Publishing under `@mohamedsaba`

`package.json`:
```json
{
  "name": "@mohamedsaba/nestjs-distributed-cron",
  "publishConfig": {
    "access": "public"
  }
}
```

An npm token is stored in GitHub secrets. On merge to `main`, semantic release updates the version, pushes a git tag, creates a GitHub release, and publishes to npm.

### 12.4 Versioning strategy

This package follows **strict semver**:

- **MAJOR**: Any change that removes or renames a decorator/option, changes the lock key format, or drops support for a NestJS major.
- **MINOR**: New features like a new decorator option, additional health endpoint fields, optional Redlock plugin.
- **PATCH**: Bug fixes, documentation improvements, dependency upgrades that don’t affect API.

### 12.5 Changelog approach

Auto‑generated from conventional commit messages (e.g., `feat:`, `fix:`, `BREAKING CHANGE:`). The changelog is published in the GitHub release notes and included in the package README.

---

## 13. Project Phases

### Phase 1: Core (Duration: ~2 developer days)
**Deliverables:**
- `DistributedCronModule` with forRoot/forRootAsync.
- `@DistributedCron()` decorator and metadata extraction.
- `LeaderElector` service with `acquireLock`, `releaseLock` using SET NX PX and Lua scripts.
- Wrapper that acquires lock, runs method, releases lock.
- Basic module initialization (no renewal, no AbortSignal).
- Example app with one cron job.
**Done criteria:** A single‑instance test passes; a two‑instance test shows only one execution.

### Phase 2: Hardening (Duration: ~2–3 days)
**Deliverables:**
- Lease renewal loop and Lua `renew.lua`.
- `AbortSignal` injection via `@DistributedCronAbort()`.
- Retry on failure with exponential backoff.
- Graceful shutdown (release locks, stop intervals).
- `leaderOnly` flag implementation.
- Comprehensive unit tests for all services.
**Done criteria:** All unit tests pass; integration test for long‑running jobs stays on one instance.

### Phase 3: Observability (Duration: ~1–2 days)
**Deliverables:**
- Health endpoint controller (`GET /distributed-cron/health`).
- Prometheus metrics service integrated with `bullmq-metrics` registry.
- Config options `enableHealthEndpoint`, `enableMetrics`.
- Documentation for wiring metrics dashboards.
**Done criteria:** Health endpoint returns correct data; Prometheus scrape succeeds.

### Phase 4: Ecosystem integrations (Duration: ~1 day)
**Deliverables:**
- Documented patterns for combining with `nestjs-idempotent` and `airlock`.
- Recipe snippets in README.
- E2E test that uses idempotency guard on a distributed cron.
**Done criteria:** Docs reviewed; integration tests pass.

### Phase 5: Stable release & documentation (Duration: ~1–2 days)
**Deliverables:**
- Full README with usage, configuration, API reference.
- In‑depth troubleshooting section (split‑brain scenarios, Redis TLS).
- Changelog for v1.0.0.
- Benchmark report comparing bare cron vs. distributed cron overhead.
- npm publish under `@mohamedsaba`.
**Done criteria:** Package installed and running from npm in a test project.

---

## 14. Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| **Redis split‑brain**: Redis replication lag causes two instances to think they hold the lock. | Use `SET NX PX` on a **single primary** Redis instance. For multi‑master, v2 Redlock plugin provides majority‑quorum acquisition. Documentation strongly recommends a standalone Redis or Sentinel‑managed failover (no read replicas for locking). |
| **Clock skew** across instances causing premature TTL expiry. | Lease TTL is based on Redis’s own clock via `PEXPIRE`, not client time. The client only uses its own clock for interval scheduling, which is tolerant to skew. Lua scripts compare strings, not timestamps. |
| **Garbage collection pauses** on Node.js instance causing renewal gaps. | `renewInterval` is set to `leaseDuration / 3`, giving ample margin. After `maxRenewFailures`, the job is aborted, and the lock expires; a healthy instance takes over. |
| **Orphan locks** due to SIGKILL or uncaught exception without graceful shutdown. | Lock TTL acts as a safety net; lock expires automatically. No manual cleanup needed. |
| **High Redis traffic** with many cron jobs renewing frequently. | Group renewal intervals and batch Lua calls (future optimization). For v1, cron jobs are typically low‑frequency (<1/minute), so overhead is negligible. |

---

## 15. Open Questions

**1. Redis client library — accept `RedisOptions` and create a dedicated connection.**  
The package will accept a standard `ioredis` connection options object and internally create its own dedicated Redis connection. This ensures that the locking logic does not interfere with the host application’s existing Redis clients (which may be used for caching, queues, or sessions) and avoids subtle problems like shared command pipelining or blocking connections in pub/sub mode. A dedicated connection also simplifies connection lifecycle management—the module can reliably reconnect, drain, or close without impacting the user’s other Redis‑dependent modules.

**2. Time zones — yes, support the `timeZone` option exactly as `@Cron()` does.**  
`@DistributedCron()` will accept a `timeZone` property and forward it transparently to the underlying `@Cron()` scheduler. This is essential for feature parity: developers currently using `@Cron()` with time‑zone‑aware schedules should be able to swap the decorator and keep their expressions intact. It also avoids the awkward situation where a “drop‑in replacement” creates regression by breaking schedule timing in deployments that span multiple regions.

**3. Async configuration — provide `forRootAsync` with the standard NestJS factory pattern.**  
The module will expose `forRootAsync` that accepts `imports`, `inject`, and `useFactory`, enabling configuration from `ConfigModule` or any dynamic source. This is not optional for a production‑grade NestJS package; without it, teams using environment‑variable‑driven config are forced into awkward workarounds.

**4. Redis unavailable at startup — throw a fatal error; do not fall back to local execution.**  
If the Redis connection cannot be established during module initialization, the application must fail to start. Falling back to executing cron jobs on every instance would silently break the singleton guarantee—the very problem the package exists to solve—and could cause duplicate side‑effects that are far worse than a temporary startup failure. A clear, loud failure in logs forces operators to fix connectivity immediately, preserving data integrity.

**5. Job name collision — throw an error at startup on duplicate `name`.**  
The module will scan all `@DistributedCron()` decorators during `OnModuleInit` and throw a `DuplicateCronJobNameError` if any two jobs share the same `name`. This prevents a silent misconfiguration where two instances of the same logical job (or two different jobs in different modules) fight over the same lock key. Providing a namespace mechanism could be a future feature, but for v1 the simplest correct behaviour is to require globally unique job names.
---

## 16. References

- [Redis `SET` command (NX, PX)](https://redis.io/commands/set/)
- [Redis `EVAL` and Lua scripting](https://redis.io/commands/eval)
- [NestJS Task Scheduling](https://docs.nestjs.com/techniques/task-scheduling)
- [nestjs-schedule documentation](https://github.com/nestjs/schedule)
- [bullmq-metrics](https://github.com/mohamedsaba/bullmq-metrics)
- [nestjs-idempotent](https://github.com/mohamedsaba/nestjs-idempotent)
- [airlock (outbox pattern)](https://github.com/mohamedsaba/airlock)
- [Redis Distributed Locks – Redlock algorithm](https://redis.io/topics/distlock)
```

This specification is self‑contained and actionable. The developer can proceed day‑by‑day with each phase, referencing the exact folder layout, Lua scripts, test plan, and API contracts defined above.