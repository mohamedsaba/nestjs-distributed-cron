import 'reflect-metadata';
import { Injectable, OnModuleInit, Logger, Inject } from '@nestjs/common';
import { DiscoveryService, MetadataScanner, ModuleRef } from '@nestjs/core';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import {
  DISTRIBUTED_CRON_KEY,
  DISTRIBUTED_CRON_ABORT_KEY,
  DISTRIBUTED_CRON_MODULE_OPTIONS,
} from '../constants/metadata.constants';
import {
  DistributedCronModuleOptions,
  DistributedCronOptions,
} from '../interfaces/distributed-cron-options.interface';
import { LeaderElector } from './leader-elector.service';

@Injectable()
export class CronSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(CronSchedulerService.name);

  constructor(
    private readonly discoveryService: DiscoveryService,
    private readonly metadataScanner: MetadataScanner,
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly leaderElector: LeaderElector,
    private readonly moduleRef: ModuleRef,
    @Inject(DISTRIBUTED_CRON_MODULE_OPTIONS)
    private readonly options: DistributedCronModuleOptions,
  ) {}

  onModuleInit() {
    this.scanAndRegisterJobs();
  }

  private scanAndRegisterJobs() {
    const providers = this.discoveryService.getProviders();
    const jobNames = new Set<string>();

    providers.forEach((wrapper) => {
      const { instance } = wrapper;
      if (!instance || !Object.getPrototypeOf(instance)) {
        return;
      }

      this.metadataScanner.scanFromPrototype(
        instance,
        Object.getPrototypeOf(instance),
        (methodName) => {
          const metadata: DistributedCronOptions & { cronExpression: string } = (
            Reflect as any
          ).getMetadata(DISTRIBUTED_CRON_KEY, instance[methodName]);

          if (metadata) {
            const jobName = metadata.name || `${instance.constructor.name}.${methodName}`;

            if (jobNames.has(jobName)) {
              throw new Error(`Duplicate distributed cron job name detected: ${jobName}`);
            }
            jobNames.add(jobName);

            this.registerJob(instance, methodName, jobName, metadata);
          }
        },
      );
    });
  }

  private registerJob(
    instance: any,
    methodName: string,
    jobName: string,
    metadata: DistributedCronOptions & { cronExpression: string },
  ) {
    const { cronExpression, ttl, leaderOnly = true } = metadata;
    const abortParamIndex: number | undefined = (Reflect as any).getMetadata(
      DISTRIBUTED_CRON_ABORT_KEY,
      instance,
      methodName,
    );

    const wrapper = async () => {
      const isLeader = await this.leaderElector.acquireLock(jobName, ttl);

      if (!isLeader && leaderOnly) {
        this.logger.debug(`Instance is not leader for job "${jobName}", skipping execution.`);
        return;
      }

      const controller = new AbortController();
      const args = [];
      if (abortParamIndex !== undefined) {
        args[abortParamIndex] = controller.signal;
      }

      try {
        if (!isLeader && !leaderOnly) {
          this.logger.debug(
            `Instance is not leader for job "${jobName}" but leaderOnly is false, executing...`,
          );
        } else {
          this.logger.debug(`Instance is leader for job "${jobName}", executing...`);
        }
        await instance[methodName](...args);
      } catch (error) {
        this.logger.error(`Error executing distributed cron job "${jobName}":`, error);
      } finally {
        await this.leaderElector.releaseLock(jobName);
        this.logger.debug(`Released lock for job "${jobName}".`);
      }
    };

    const cronJob = new CronJob(cronExpression, wrapper);
    this.schedulerRegistry.addCronJob(jobName, cronJob);
    cronJob.start();

    this.logger.log(
      `Registered distributed cron job "${jobName}" with expression "${cronExpression}"`,
    );
  }
}
