import { z } from 'zod';

export enum EventStatus {
  DRAFT = 'DRAFT',
  PUBLISHED = 'PUBLISHED',
  CANCELLED = 'CANCELLED',
  COMPLETED = 'COMPLETED'
}

export enum EventVisibility {
  PUBLIC = 'PUBLIC',
  PRIVATE = 'PRIVATE',
}

export enum EventLocationType {
  OFFLINE = 'OFFLINE',
  VIRTUAL = 'VIRTUAL',
}

export enum EventParticipationType {
  TICKET = 'TICKET',      // Participated by buying a ticket
  FREE = 'FREE',          // Participated in a free event
  WAITLIST = 'WAITLIST'   // On the waitlist
}

export enum EventParticipationStatus {
  REGISTERED = 'REGISTERED',  // Initial registration
  CONFIRMED = 'CONFIRMED',    // Attendance confirmed (checked in)
  CANCELLED = 'CANCELLED',    // Cancelled participation
  NO_SHOW = 'NO_SHOW'        // Didn't attend
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
  title: z.string(),
  description: z.string(),
  location: z.string(),
  startDateTime: z.date(),
  endDateTime: z.date(),
  timezone: z.string(),
  capacity: z.number(),
  status: z.nativeEnum(EventStatus),
  visibility: z.nativeEnum(EventVisibility),
  isPublished: z.boolean(),
  tags: z.array(z.string()),
  categories: z.array(z.string()),
  coverImage: z.string().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const eventParticipationSchema = z.object({
  id: z.string(),
  eventId: z.string(),
  userId: z.string(),
  type: z.nativeEnum(EventParticipationType),
  status: z.nativeEnum(EventParticipationStatus),
  ticketId: z.string().optional(),
  registeredAt: z.date(),
  checkedInAt: z.date().optional(),
  cancelledAt: z.date().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type Event = z.infer<typeof eventSchema>;
export type EventParticipation = z.infer<typeof eventParticipationSchema>;

export type CreateEventRequest = Omit<Event, 
  'id' | 'status' | 'isPublished' | 'createdAt' | 'updatedAt'
>;

export type UpdateEventRequest = Partial<CreateEventRequest> & { id: string };

export interface EventSearchParams {
  categories?: string[];
  tags?: string[];
  startDate?: Date;
  endDate?: Date;
  location?: string;
  status?: EventStatus;
  visibility?: EventVisibility;
  limit?: number;
  offset?: number;
  organizerId?: string;
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

export interface EventStats {
  totalParticipants: number;
  checkedIn: number;
  cancelled: number;
  noShow: number;
  waitlist: number;
}

export interface UserEventHistory {
  upcoming: Array<{
    event: Event;
    participation: EventParticipation;
  }>;
  past: Array<{
    event: Event;
    participation: EventParticipation;
  }>;
  waitlist: Array<{
    event: Event;
    participation: EventParticipation;
  }>;
} 