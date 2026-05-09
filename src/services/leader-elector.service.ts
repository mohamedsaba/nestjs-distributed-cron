import 'reflect-metadata';
import { Inject, Injectable, OnModuleInit, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { randomUUID } from 'crypto';
import { DISTRIBUTED_CRON_MODULE_OPTIONS, REDIS_CLIENT } from '../constants/metadata.constants';
import { DistributedCronModuleOptions } from '../interfaces/distributed-cron-options.interface';
import { RENEW_LUA, RELEASE_LUA } from '../lua/scripts';

@Injectable()
export class LeaderElector implements OnModuleInit {
  private readonly instanceId: string;
  private readonly leaseDuration: number;
  private readonly logger = new Logger(LeaderElector.name);

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(DISTRIBUTED_CRON_MODULE_OPTIONS)
    private readonly options: DistributedCronModuleOptions,
  ) {
    this.instanceId = options.instanceId || process.env.POD_NAME || randomUUID();
    this.leaseDuration = options.leaseDuration || 15_000;
  }

  async onModuleInit() {
    try {
      // Verify Redis connection at startup as required by spec (Question 4)
      await this.redis.ping();
      this.logger.log(`Redis connection verified. Instance ID: ${this.instanceId}`);
    } catch (error) {
      this.logger.error('Failed to connect to Redis at startup. This is a fatal error.');
      throw error;
    }

    this.redis.defineCommand('renewLock', {
      numberOfKeys: 1,
      lua: RENEW_LUA,
    });
    this.redis.defineCommand('releaseLockScript', {
      numberOfKeys: 1,
      lua: RELEASE_LUA,
    });
  }

  private getLockKey(jobName: string): string {
    return `distributed-cron:${jobName}:lock`;
  }

  async acquireLock(jobName: string, ttlMs?: number): Promise<boolean> {
    const key = this.getLockKey(jobName);
    const ttl = ttlMs || this.leaseDuration;
    const result = await this.redis.set(key, this.instanceId, 'PX', ttl, 'NX');
    return result === 'OK';
  }

  async renewLock(jobName: string, ttlMs?: number): Promise<boolean> {
    const key = this.getLockKey(jobName);
    const ttl = ttlMs || this.leaseDuration;
    // Custom commands defined in onModuleInit
    const result = await (this.redis as any).renewLock(key, this.instanceId, ttl);
    return result === 1;
  }

  async releaseLock(jobName: string): Promise<void> {
    const key = this.getLockKey(jobName);
    // Custom commands defined in onModuleInit
    await (this.redis as any).releaseLockScript(key, this.instanceId);
  }

  async amILeader(jobName: string): Promise<boolean> {
    const leader = await this.getCurrentLeader(jobName);
    return leader === this.instanceId;
  }

  async getCurrentLeader(jobName: string): Promise<string | null> {
    const key = this.getLockKey(jobName);
    return this.redis.get(key);
  }

  async getLeaseExpiration(jobName: string): Promise<number | null> {
    const key = this.getLockKey(jobName);
    const pttl = await this.redis.pttl(key);
    if (pttl < 0) return null;
    return Date.now() + pttl;
  }

  getInstanceId(): string {
    return this.instanceId;
  }
}
