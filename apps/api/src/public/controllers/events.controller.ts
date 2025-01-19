import { Controller, Get, Query, UseFilters } from '@nestjs/common';
import { PublicEventsService } from '../services/events.service';
import { HttpExceptionFilter } from '../../common/filters/http-exception.filter';
import { EventSearchParams } from '@supafaya/core';

@Controller('api/v1/public/events')
@UseFilters(HttpExceptionFilter)
export class PublicEventsController {
  constructor(private readonly eventsService: PublicEventsService) {}

  @Get()
  async listEvents(@Query() params: EventSearchParams) {
    const events = await this.eventsService.listEvents(params);
    return {
      data: events,
      meta: {
        total: events.length,
      },
    };
  }

  @Get('search')
  async searchEvents(@Query('query') query: string, @Query() params: EventSearchParams) {
    const events = await this.eventsService.searchEvents(query, params);
    return {
      data: events,
      meta: {
        total: events.length,
        query,
      },
    };
  }
} 