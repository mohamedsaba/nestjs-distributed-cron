import { Test, TestingModule } from '@nestjs/testing';
import { DiscoveryService, MetadataScanner, ModuleRef } from '@nestjs/core';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronSchedulerService } from '../../src/services/cron-scheduler.service';
import { LeaderElector } from '../../src/services/leader-elector.service';
import {
  DISTRIBUTED_CRON_MODULE_OPTIONS,
  DISTRIBUTED_CRON_KEY,
} from '../../src/constants/metadata.constants';

describe('CronSchedulerService', () => {
  let service: CronSchedulerService;
  let discoveryService: any;
  let metadataScanner: any;
  let schedulerRegistry: any;
  let leaderElector: any;

  beforeEach(async () => {
    discoveryService = {
      getProviders: jest.fn().mockReturnValue([]),
    };
    metadataScanner = {
      scanFromPrototype: jest.fn(),
    };
    schedulerRegistry = {
      addCronJob: jest.fn(),
    };
    leaderElector = {
      acquireLock: jest.fn(),
      releaseLock: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CronSchedulerService,
        { provide: DiscoveryService, useValue: discoveryService },
        { provide: MetadataScanner, useValue: metadataScanner },
        { provide: SchedulerRegistry, useValue: schedulerRegistry },
        { provide: LeaderElector, useValue: leaderElector },
        { provide: ModuleRef, useValue: {} },
        {
          provide: DISTRIBUTED_CRON_MODULE_OPTIONS,
          useValue: { instanceId: 'test-instance' },
        },
      ],
    }).compile();

    service = module.get<CronSchedulerService>(CronSchedulerService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should scan and register jobs on init', () => {
    const testInstance = {
      testMethod: () => {},
    };
    discoveryService.getProviders.mockReturnValue([{ instance: testInstance }]);
    metadataScanner.scanFromPrototype.mockImplementation((instance, proto, callback) => {
      callback('testMethod');
    });
    Reflect.defineMetadata(DISTRIBUTED_CRON_KEY, { cronExpression: '* * * * *' }, testInstance.testMethod);

    service.onModuleInit();

    expect(schedulerRegistry.addCronJob).toHaveBeenCalledWith(
      'Object.testMethod',
      expect.any(Object),
    );
  });
});
