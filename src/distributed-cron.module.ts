import { DynamicModule, Module, Global, Provider, OnModuleDestroy, Inject } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import Redis from 'ioredis';
import { DISTRIBUTED_CRON_MODULE_OPTIONS, REDIS_CLIENT } from './constants/metadata.constants';
import { DistributedCronModuleOptions } from './interfaces/distributed-cron-options.interface';
import { RedisClientProvider } from './services/redis-client.provider';
import { LeaderElector } from './services/leader-elector.service';
import { CronSchedulerService } from './services/cron-scheduler.service';

@Global()
@Module({
  imports: [DiscoveryModule, ScheduleModule.forRoot()],
})
export class DistributedCronModule implements OnModuleDestroy {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async onModuleDestroy() {
    // Gracefully close Redis connection on shutdown
    if (this.redis) {
      await this.redis.quit();
    }
  }

  static forRoot(options: DistributedCronModuleOptions): DynamicModule {
    return {
      module: DistributedCronModule,
      providers: [
        {
          provide: DISTRIBUTED_CRON_MODULE_OPTIONS,
          useValue: options,
        },
        RedisClientProvider,
        LeaderElector,
        CronSchedulerService,
      ],
      exports: [LeaderElector],
    };
  }

  static forRootAsync(options: {
    imports?: any[];
    useFactory?: (
      ...args: any[]
    ) => Promise<DistributedCronModuleOptions> | DistributedCronModuleOptions;
    useClass?: any;
    useExisting?: any;
    inject?: any[];
  }): DynamicModule {
    const providers: Provider[] = [
      this.createAsyncOptionsProvider(options),
      RedisClientProvider,
      LeaderElector,
      CronSchedulerService,
    ];

    if (options.useClass) {
      providers.push({
        provide: options.useClass,
        useClass: options.useClass,
      });
    }

    return {
      module: DistributedCronModule,
      imports: options.imports || [],
      providers,
      exports: [LeaderElector],
    };
  }

  private static createAsyncOptionsProvider(options: {
    useFactory?: (
      ...args: any[]
    ) => Promise<DistributedCronModuleOptions> | DistributedCronModuleOptions;
    useClass?: any;
    useExisting?: any;
    inject?: any[];
  }): Provider {
    if (options.useFactory) {
      return {
        provide: DISTRIBUTED_CRON_MODULE_OPTIONS,
        useFactory: options.useFactory,
        inject: options.inject || [],
      };
    }
    return {
      provide: DISTRIBUTED_CRON_MODULE_OPTIONS,
      useFactory: async (optionsFactory: any) =>
        await optionsFactory.createDistributedCronOptions(),
      inject: [options.useClass || options.useExisting],
    };
  }
}
