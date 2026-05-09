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

## License

[MIT](LICENSE)
