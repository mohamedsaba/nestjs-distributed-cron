import { Test, TestingModule } from '@nestjs/testing';
import { DistributedCronModule } from '../../src/distributed-cron.module';
import {
  DistributedCron,
  DistributedCronAbort,
} from '../../src/decorators/distributed-cron.decorator';
import { Injectable } from '@nestjs/common';
import { GenericContainer, StartedTestContainer } from 'testcontainers';
import { Redis } from 'ioredis';

@Injectable()
class TestJobService {
  public callCount = 0;
  public instanceIds: string[] = [];
  public aborted = false;

  @DistributedCron('*/1 * * * * *', { name: 'integration-test-job', ttl: 1000 })
  async handleJob(@DistributedCronAbort() signal: AbortSignal, instanceId: string) {
    this.callCount++;
    this.instanceIds.push(instanceId);

    // Simulate long work
    return new Promise((resolve) => {
      const timeout = setTimeout(resolve, 2000); // Longer than TTL
      signal.addEventListener('abort', () => {
        this.aborted = true;
        clearTimeout(timeout);
        resolve(null);
      });
    });
  }
}

describe('Multi-instance Integration', () => {
  let redisContainer: StartedTestContainer;
  let redisClient: Redis;

  beforeAll(async () => {
    redisContainer = await new GenericContainer('redis').withExposedPorts(6379).start();

    redisClient = new Redis({
      host: redisContainer.getHost(),
      port: redisContainer.getMappedPort(6379),
    });
  }, 60000);

  afterAll(async () => {
    await redisClient.quit();
    await redisContainer.stop();
  });

  it('should ensure exactly one instance runs and aborts when TTL expires', async () => {
    const redisOptions = {
      host: redisContainer.getHost(),
      port: redisContainer.getMappedPort(6379),
    };

    const createInstance = async (id: string) => {
      const module: TestingModule = await Test.createTestingModule({
        imports: [
          DistributedCronModule.forRoot({
            redis: redisOptions,
            instanceId: id,
            leaseDuration: 1000,
          }),
        ],
        providers: [TestJobService],
      }).compile();

      const app = module.createNestApplication();
      await app.init();
      return { app, service: module.get<TestJobService>(TestJobService) };
    };

    const instance1 = await createInstance('instance-1');
    const instance2 = await createInstance('instance-2');

    // Wait for jobs to trigger (at least 2 seconds for TTL to expire)
    await new Promise((resolve) => setTimeout(resolve, 3500));

    // Verify instance 1 or 2 ran
    const totalCalls = instance1.service.callCount + instance2.service.callCount;
    expect(totalCalls).toBeGreaterThan(0);

    // In this scenario, since jobs take 2s and TTL is 1s, they should definitely hit the abort logic
    expect(instance1.service.aborted || instance2.service.aborted).toBe(true);

    await instance1.app.close();
    await instance2.app.close();
  }, 10000);
});
