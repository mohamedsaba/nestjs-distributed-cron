# nestjs-distributed-cron

> **Distributed singleton cron scheduler with Redis-backed leader election for NestJS**

## Overview

`nestjs-distributed-cron` is a NestJS-first package that augments `@nestjs/schedule` with distributed leader election using Redis. It provides a drop‑in replacement for the familiar `@Cron()` decorator, guaranteeing that a scheduled job runs on **exactly one** instance, even when your application is scaled to dozens of pods.

## Key Features

- **@DistributedCron()**: A drop‑in replacement for `@Cron()`.
- **Leader Election**: Redis-backed coordination using `SET NX PX`.
- **Atomic Operations**: Lua-scripted lock renewal and release for maximum safety.
- **AbortSignal Support**: Injects an `AbortSignal` to allow jobs to stop gracefully if leadership is lost.
- **Fail-Fast**: Verifies Redis connectivity at startup to prevent silent split-brain scenarios.
- **Highly Configurable**: Custom lease durations, instance IDs, and retry strategies.

## Installation

```bash
npm install @mohamedsaba/nestjs-distributed-cron ioredis
```

*Note: `@nestjs/schedule` and `ioredis` are peer dependencies.*

## Quick Start

### 1. Register the Module

```typescript
import { Module } from '@nestjs/common';
import { DistributedCronModule } from '@mohamedsaba/nestjs-distributed-cron';

@Module({
  imports: [
    DistributedCronModule.forRoot({
      redis: {
        host: 'localhost',
        port: 6379,
      },
      leaseDuration: 15000, // 15 seconds
    }),
  ],
})
export class AppModule {}
```

### 2. Use the Decorator

```typescript
import { Injectable } from '@nestjs/common';
import { DistributedCron, DistributedCronAbort } from '@mohamedsaba/nestjs-distributed-cron';

@Injectable()
export class ReportService {
  @DistributedCron('0 8 * * *', { name: 'daily-report' })
  async generateReport(@DistributedCronAbort() signal: AbortSignal) {
    // This will only run on one instance at a time.
    // Use 'signal' to check if leadership is lost during execution.
    if (signal.aborted) return;
    
    // Your logic here...
  }
}
```

## Configuration

| Option | Description | Default |
| --- | --- | --- |
| `redis` | `ioredis` connection options | (Required) |
| `leaseDuration` | Duration (ms) the lock is held | `15000` |
| `instanceId` | Unique ID for the instance | `POD_NAME` or UUID |
| `autoRenew` | Automatically renew the lease | `true` |

## Security & Reliability

The distributed cron implementation is designed with a "Safety First" approach to ensure exactly-one execution even in unstable environments.

### Exactly-One Guarantee
- **Atomic Lock Release**: Uses Lua scripts to verify that an instance only deletes its *own* lock. This prevents a slow instance from accidentally killing a lock acquired by a newer leader.
- **Fail-Safe Acquisition**: If Redis is unreachable during a tick, the system skips execution for that instance. This prevents split-brain scenarios where multiple instances might think they are leaders due to network partitions.

### Lease Duration vs. Job Runtime
It is critical that your job's execution time is shorter than the `leaseDuration` (TTL).
- If a job takes longer than the TTL, the lock will expire on Redis.
- Another instance may then acquire the lock and start running concurrently.
- **AbortSignal**: To mitigate this, always inject the `@DistributedCronAbort()` signal. The signal will be aborted automatically if the job exceeds the lease duration.

```typescript
@DistributedCron('*/10 * * * *', { ttl: 5000 })
async handleLongJob(@DistributedCronAbort() signal: AbortSignal) {
  // Check signal.aborted or use signal in fetch/db calls
}
```

### Process Crashes
If an instance crashes while holding a lock, the job will not run until the TTL expires. Choose a `leaseDuration` that balances recovery time with the risk of missed ticks.

## License

[MIT](LICENSE)
