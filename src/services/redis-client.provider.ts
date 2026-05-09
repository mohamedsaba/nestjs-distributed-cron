import { Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { DISTRIBUTED_CRON_MODULE_OPTIONS, REDIS_CLIENT } from '../constants/metadata.constants';
import { DistributedCronModuleOptions } from '../interfaces/distributed-cron-options.interface';

export const RedisClientProvider = {
  provide: REDIS_CLIENT,
  useFactory: (options: DistributedCronModuleOptions) => {
    const logger = new Logger('DistributedCronRedis');
    const client = new Redis(options.redis);

    client.on('error', (err) => {
      logger.error('Redis connection error', err);
    });

    client.on('connect', () => {
      logger.log('Connected to Redis');
    });

    return client;
  },
  inject: [DISTRIBUTED_CRON_MODULE_OPTIONS],
};
