import { Module } from '@nestjs/common';
import { AdminEventsController } from './controllers/events.controller';
import { AdminTicketsController } from './controllers/tickets.controller';
import { AdminEventsService } from './services/events.service';
import { AdminTicketsService } from './services/tickets.service';

@Module({
  controllers: [
    AdminEventsController,
    AdminTicketsController,
  ],
  providers: [
    AdminEventsService,
    AdminTicketsService,
  ],
})
export class AdminModule {} 