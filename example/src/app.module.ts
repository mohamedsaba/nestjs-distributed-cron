import { Module } from '@nestjs/common';
import { DistributedCronModule } from '../../src/distributed-cron.module';
import { ReportService } from './report.service';

@Module({
  imports: [
    DistributedCronModule.forRoot({
      redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
      },
      leaseDuration: 5000,
      instanceId: process.env.POD_NAME || 'instance-1',
    }),
  ],
  providers: [ReportService],
})
export class AppModule {}
