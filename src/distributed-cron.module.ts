import { DynamicModule, Module, Global, Provider } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { DISTRIBUTED_CRON_MODULE_OPTIONS } from './constants/metadata.constants';
import { DistributedCronModuleOptions } from './interfaces/distributed-cron-options.interface';
import { RedisClientProvider } from './services/redis-client.provider';
import { LeaderElector } from './services/leader-elector.service';
import { CronSchedulerService } from './services/cron-scheduler.service';

@Global()
@Module({
  imports: [DiscoveryModule, ScheduleModule.forRoot()],
})
export class DistributedCronModule {
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
    useFactory: (
      ...args: any[]
    ) => Promise<DistributedCronModuleOptions> | DistributedCronModuleOptions;
    inject?: any[];
  }): DynamicModule {
    const optionsProvider: Provider = {
      provide: DISTRIBUTED_CRON_MODULE_OPTIONS,
      useFactory: options.useFactory,
      inject: options.inject || [],
    };

    return {
      module: DistributedCronModule,
      imports: options.imports || [],
      providers: [optionsProvider, RedisClientProvider, LeaderElector, CronSchedulerService],
      exports: [LeaderElector],
    };
  }
}
