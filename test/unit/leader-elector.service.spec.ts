import { Test, TestingModule } from '@nestjs/testing';
import { LeaderElector } from '../../src/services/leader-elector.service';
import {
  DISTRIBUTED_CRON_MODULE_OPTIONS,
  REDIS_CLIENT,
} from '../../src/constants/metadata.constants';

describe('LeaderElector', () => {
  let service: LeaderElector;
  let redisMock: any;

  beforeEach(async () => {
    redisMock = {
      ping: jest.fn().mockResolvedValue('PONG'),
      defineCommand: jest.fn(),
      set: jest.fn(),
      get: jest.fn(),
      pttl: jest.fn(),
      renewLock: jest.fn(),
      releaseLockScript: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LeaderElector,
        {
          provide: REDIS_CLIENT,
          useValue: redisMock,
        },
        {
          provide: DISTRIBUTED_CRON_MODULE_OPTIONS,
          useValue: {
            instanceId: 'test-instance',
            leaseDuration: 1000,
          },
        },
      ],
    }).compile();

    service = module.get<LeaderElector>(LeaderElector);
    await service.onModuleInit();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should define commands on init', () => {
    expect(redisMock.defineCommand).toHaveBeenCalledWith('renewLock', expect.any(Object));
    expect(redisMock.defineCommand).toHaveBeenCalledWith('releaseLockScript', expect.any(Object));
  });

  describe('acquireLock', () => {
    it('should return true when lock is acquired', async () => {
      redisMock.set.mockResolvedValue('OK');
      const result = await service.acquireLock('test-job');
      expect(result).toBe(true);
      expect(redisMock.set).toHaveBeenCalledWith(
        'distributed-cron:test-job:lock',
        'test-instance',
        'PX',
        1000,
        'NX',
      );
    });

    it('should return false when lock is not acquired', async () => {
      redisMock.set.mockResolvedValue(null);
      const result = await service.acquireLock('test-job');
      expect(result).toBe(false);
    });
  });

  describe('renewLock', () => {
    it('should return true when lock is renewed', async () => {
      redisMock.renewLock.mockResolvedValue(1);
      const result = await service.renewLock('test-job');
      expect(result).toBe(true);
      expect(redisMock.renewLock).toHaveBeenCalledWith(
        'distributed-cron:test-job:lock',
        'test-instance',
        1000,
      );
    });

    it('should return false when lock is not owned by instance', async () => {
      redisMock.renewLock.mockResolvedValue(0);
      const result = await service.renewLock('test-job');
      expect(result).toBe(false);
    });
  });

  describe('releaseLock', () => {
    it('should call releaseLockScript', async () => {
      await service.releaseLock('test-job');
      expect(redisMock.releaseLockScript).toHaveBeenCalledWith(
        'distributed-cron:test-job:lock',
        'test-instance',
      );
    });
  });

  describe('amILeader', () => {
    it('should return true if instance is leader', async () => {
      redisMock.get.mockResolvedValue('test-instance');
      const result = await service.amILeader('test-job');
      expect(result).toBe(true);
    });

    it('should return false if instance is not leader', async () => {
      redisMock.get.mockResolvedValue('other-instance');
      const result = await service.amILeader('test-job');
      expect(result).toBe(false);
    });
  });
});
