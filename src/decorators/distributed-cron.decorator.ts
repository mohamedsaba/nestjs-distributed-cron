import 'reflect-metadata';
import { SetMetadata } from '@nestjs/common';
import { DISTRIBUTED_CRON_KEY, DISTRIBUTED_CRON_ABORT_KEY } from '../constants/metadata.constants';
import { DistributedCronOptions } from '../interfaces/distributed-cron-options.interface';

/**
 * Decorator that marks a method for distributed execution.
 * @param cronExpression The cron expression (e.g., '0 8 * * *').
 * @param options Additional options for the job.
 */
export function DistributedCron(
  cronExpression: string,
  options: DistributedCronOptions = {},
): MethodDecorator {
  return SetMetadata(DISTRIBUTED_CRON_KEY, {
    cronExpression,
    ...options,
  });
}

/**
 * Parameter decorator that injects an AbortSignal that is aborted when leadership is lost.
 */
export function DistributedCronAbort(): ParameterDecorator {
  return (target: any, propertyKey: string | symbol | undefined, parameterIndex: number) => {
    if (propertyKey) {
      (Reflect as any).defineMetadata(
        DISTRIBUTED_CRON_ABORT_KEY,
        parameterIndex,
        target,
        propertyKey,
      );
    }
  };
}
