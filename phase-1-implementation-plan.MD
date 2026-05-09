## Phase 1 Implementation Order — `nestjs-distributed-cron` Core

Complete each task in order. Each task builds on the previous. Testing gates ensure correctness before proceeding.

---

### Task 1: Project scaffold & dependencies
**Build:**
- Create project directory structure (all folders from spec: `src/`, `test/`, `example/`).
- Copy the provided `package.json`, `tsconfig.json`, `tsconfig.build.json`, and `jest.config.ts`.
- Install dependencies with `npm install`.

**Test:**
- `npm run lint` and `npm run build` both pass (even though the source is empty).
- Jest runs a dummy test (e.g., `test/dummy.spec.ts`).

**Unblocks:** All future tasks (project infrastructure is ready).

---

### Task 2: Redis client provider
**Build:**
- `src/services/redis-client.provider.ts` — a factory that creates an `ioredis` client from `DistributedCronModuleOptions.redis`.
- Export a token (`REDIS_CLIENT`) and provide it in the module.
- Handle connection error logging (but do not crash the process—let the module decide).

**Test (unit):**
- With a mock `ioredis` constructor, verify that the factory returns a client and that the token is properly injected.

**Unblocks:** `LeaderElector` service (needs Redis client injection).

---

### Task 3: LeaderElector service
**Build:**
- `src/lua/renew.lua` and `src/lua/release.lua` as plain text files (the exact scripts from the spec).
- `src/services/leader-elector.service.ts`:
  - `acquireLock(jobName: string, ttlMs: number): Promise<boolean>` – calls `SET jobName instanceId NX PX ttlMs`.
  - `releaseLock(jobName: string): Promise<void>` – calls `release.lua` with the instance ID.
  - `amILeader(jobName: string): Promise<boolean>` – GET and compare.
  - `getCurrentLeader(jobName: string): Promise<string | null>` – GET.
  - `getLeaseExpiration(jobName: string): Promise<number | null>` – PTTL + Date.now().
- Use a dedicated Redis connection (from Task 2).

**Test:**
- **Unit:** Mock ioredis calls; verify Lua scripts are loaded and called correctly.
- **Integration:** Start a real Redis (Docker), acquire lock, verify another instance cannot acquire, release, verify second can acquire.

**Unblocks:** Cron wrapper logic (needs lock/unlock).

---

### Task 4: Decorators & metadata
**Build:**
- `src/constants/metadata.constants.ts` — define `DISTRIBUTED_CRON_KEY` (`Symbol('distributed-cron')`).
- `src/decorators/distributed-cron.decorator.ts`:
  - `@DistributedCron(cronExpression: string, options?: DistributedCronOptions)` – stores metadata on the method (cron expression, name, ttl, autoRenew, etc.).
  - `@DistributedCronAbort()` – parameter decorator that stores the parameter index under a separate key.

**Test (unit):**
- Use `Reflect.getMetadata` to verify all options are stored.
- Verify that `@DistributedCronAbort` records the parameter index correctly.

**Unblocks:** `CronSchedulerService` (needs to read metadata from providers).

---

### Task 5: CronSchedulerService (method wrapping & registration)
**Build:**
- `src/services/cron-scheduler.service.ts`:
  - Implements `OnModuleInit`.
  - Scans all providers using `ModuleRef` and `DiscoveryService` (from `@nestjs/core`).
  - For each decorated method, creates a wrapper function that:
    1. Calls `leaderElector.acquireLock(jobName, ttl)`. If `false`, return immediately.
    2. Executes the original method.
    3. Calls `leaderElector.releaseLock(jobName)` in a `finally` block.
  - Registers the wrapper (not the original method) with `SchedulerRegistry.addCronJob` from `@nestjs/schedule`.
  - Derives job name from `options.name` or `ClassName.methodName`.
  - Build with the module configuration for TTL defaults.

**Test (unit):**
- Mock `LeaderElector`, `SchedulerRegistry`, `DiscoveryService`.
- Verify that a provider with `@DistributedCron('*/1 * * * *')` results in a cron job being added.
- Verify that when the cron tick fires, `acquireLock` is called before the original method, and `releaseLock` is called after.
- If lock is held by another instance, original method is **not** called.

**Unblocks:** Full module integration (everything except real multi‑instance).

---

### Task 6: DistributedCronModule assembly
**Build:**
- `src/distributed-cron.module.ts` — dynamic module:
  - `forRoot(options)`: returns a NestJS module with imports for `ScheduleModule` (from `@nestjs/schedule`), providers for `LeaderElector`, `CronSchedulerService`, `RedisClientProvider`, and exports `LeaderElector`.
  - `forRootAsync(options)`: same dynamic pattern with `useFactory`, `inject`, `imports`.
  - Global metadata scanner can be enabled by importing the module; it will automatically pick up providers from the host module.
- `src/index.ts` — barrel exports.

**Test (unit):**
- Create a test module that imports `DistributedCronModule.forRoot({ ... })`, provide a service with a `@DistributedCron('* * * * *')` method, and verify that the service is wrapped and registered (via mocked SchedulerRegistry).

**Unblocks:** Example app (actual runtime).

---

### Task 7: Example app & multi-instance validation
**Build:**
- `example/src/app.module.ts` — imports `DistributedCronModule.forRoot(...)` with a local Redis config.
- `example/src/report.service.ts` — a simple service with `@DistributedCron('*/30 * * * * *', { name: 'ping' })` that logs “Cron executed by instanceId”.
- Run single instance with `npm run start:dev` inside `example/`; observe logs every 30 seconds.
- **Multi-instance test:**
  - Start two instances with different `POD_NAME` values (or `instanceId` config).
  - Observe that only one instance logs per tick.
  - Kill the logging instance; within the next cycle the other takes over.

**Test (manual):**
- Verify exactly‑one‑execution guarantee across multiple processes.

**Unblocks:** Confirmation that Phase 1 core functionality is complete, and all previous tasks are verified end‑to‑end. This is the “Done criteria” for Phase 1. Once this works, you can safely move to Phase 2 (lease renewal, AbortSignal, graceful shutdown).