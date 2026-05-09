import {
  DISTRIBUTED_CRON_KEY,
  DISTRIBUTED_CRON_ABORT_KEY,
} from '../../src/constants/metadata.constants';
import {
  DistributedCron,
  DistributedCronAbort,
} from '../../src/decorators/distributed-cron.decorator';

describe('Decorators', () => {
  class TestService {
    @DistributedCron('*/1 * * * *', { name: 'test-job', ttl: 5000 })
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    testMethod(@DistributedCronAbort() _abortSignal: AbortSignal) {
      // Mock method
    }
  }

  it('should store cron metadata on the method', () => {
    const metadata = (Reflect as any).getMetadata(
      DISTRIBUTED_CRON_KEY,
      TestService.prototype.testMethod,
    );
    expect(metadata).toEqual({
      cronExpression: '*/1 * * * *',
      name: 'test-job',
      ttl: 5000,
    });
  });

  it('should store abort signal parameter index', () => {
    const parameterIndex = (Reflect as any).getMetadata(
      DISTRIBUTED_CRON_ABORT_KEY,
      TestService.prototype,
      'testMethod',
    );
    expect(parameterIndex).toBe(0);
  });
});
