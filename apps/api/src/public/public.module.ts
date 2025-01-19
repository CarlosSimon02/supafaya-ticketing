import { Module } from '@nestjs/common';
import { PublicEventsController } from './controllers/events.controller';
import { PublicEventsService } from './services/events.service';

@Module({
  controllers: [PublicEventsController],
  providers: [PublicEventsService],
})
export class PublicModule {} 