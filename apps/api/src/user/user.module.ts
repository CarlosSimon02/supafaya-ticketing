import { Module } from '@nestjs/common';
import { UserEventsController } from './controllers/events.controller';
import { UserTicketsController } from './controllers/tickets.controller';
import { UserEventsService } from './services/events.service';
import { UserTicketsService } from './services/tickets.service';

@Module({
  controllers: [
    UserEventsController,
    UserTicketsController,
  ],
  providers: [
    UserEventsService,
    UserTicketsService,
  ],
})
export class UserModule {} 