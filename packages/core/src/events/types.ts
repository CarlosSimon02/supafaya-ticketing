import { z } from 'zod';

export enum EventVisibility {
  PUBLIC = 'PUBLIC',
  PRIVATE = 'PRIVATE',
}

export enum EventLocationType {
  OFFLINE = 'OFFLINE',
  VIRTUAL = 'VIRTUAL',
}

// TODO: Integrate with Google Location API
export const eventLocationSchema = z.object({
  type: z.nativeEnum(EventLocationType),
  // For now, just store as string. Later will be replaced with proper location data
  value: z.string(),
});

export type EventLocation = z.infer<typeof eventLocationSchema>;

export const eventSchema = z.object({
  id: z.string(),
  organizerId: z.string(),
  name: z.string().min(1),
  description: z.string().optional(),
  startDateTime: z.date(),
  endDateTime: z.date(),
  timezone: z.string(), // e.g., "Asia/Manila"
  location: eventLocationSchema,
  capacity: z.number().int().positive(),
  visibility: z.nativeEnum(EventVisibility).default(EventVisibility.PUBLIC),
  requireApproval: z.boolean().default(false),
  ticketsPerCustomer: z.number().int().positive().default(1),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type Event = z.infer<typeof eventSchema>;

export interface CreateEventRequest {
  name: string;
  description?: string;
  startDateTime: Date;
  endDateTime: Date;
  timezone: string;
  location: EventLocation;
  capacity: number;
  visibility?: EventVisibility;
  requireApproval?: boolean;
  ticketsPerCustomer?: number;
}

export interface UpdateEventRequest extends Partial<CreateEventRequest> {
  id: string;
}

export interface EventSearchParams {
  startDate?: Date;
  endDate?: Date;
  location?: string;
  organizerId?: string;
  visibility?: EventVisibility;
}

export class EventError extends Error {
  constructor(
    message: string,
    public code: string,
    public originalError?: unknown
  ) {
    super(message);
    this.name = 'EventError';
  }
}

export class EventNotFoundError extends EventError {
  constructor(eventId: string) {
    super(
      `Event with ID ${eventId} not found`,
      'event/not-found'
    );
    this.name = 'EventNotFoundError';
  }
}

export class EventCapacityError extends EventError {
  constructor(eventId: string) {
    super(
      `Event with ID ${eventId} has reached capacity`,
      'event/capacity-reached'
    );
    this.name = 'EventCapacityError';
  }
}

export class InvalidEventDatesError extends EventError {
  constructor(message: string) {
    super(
      message,
      'event/invalid-dates'
    );
    this.name = 'InvalidEventDatesError';
  }
} 