import { RedisOptions } from 'ioredis';

export interface DistributedCronModuleOptions {
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
  retryStrategy?: boolean; // Simplifying for now, spec mentions RetryStrategy but not its shape.

  /**
   * If true, automatically register the health endpoint @ /distributed-cron/health.
   * @default true
   */
  enableHealthEndpoint?: boolean;

  /**
   * If true, expose Prometheus metrics.
   * @default false
   */
  enableMetrics?: boolean;
}

export interface DistributedCronOptions {
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

  /**
   * Callback invoked when the cron job fails.
   */
  onError?: (error: any) => void;
}
