import { Injectable } from '@nestjs/common';
import { IEventService, Event, EventSearchParams } from '@supafaya/core';

@Injectable()
export class PublicEventsService {
  constructor(private readonly eventService: IEventService) {}

  async listEvents(params?: EventSearchParams): Promise<Event[]> {
    return this.eventService.listEvents(params);
  }

  async searchEvents(query: string, params?: EventSearchParams): Promise<Event[]> {
    return this.eventService.searchEvents(query, params);
  }
} 