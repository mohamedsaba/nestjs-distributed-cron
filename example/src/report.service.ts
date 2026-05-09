import { Injectable, Logger } from '@nestjs/common';
import { DistributedCron, DistributedCronAbort } from '../../src/decorators/distributed-cron.decorator';

@Injectable()
export class ReportService {
  private readonly logger = new Logger(ReportService.name);

  @DistributedCron('*/10 * * * * *', { name: 'ping-job' })
  async handlePing(@DistributedCronAbort() signal: AbortSignal) {
    this.logger.log(`[${process.env.POD_NAME || 'local'}] Ping job executed!`);
    
    // Simulate some work
    for (let i = 0; i < 5; i++) {
      if (signal.aborted) {
        this.logger.warn(`[${process.env.POD_NAME || 'local'}] Job aborted!`);
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
}
