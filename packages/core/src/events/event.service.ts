import { 
  Event, 
  CreateEventRequest, 
  UpdateEventRequest, 
  EventSearchParams 
} from './types';

export interface IEventService {
  // Event CRUD
  createEvent(organizerId: string, request: CreateEventRequest): Promise<Event>;
  getEvent(eventId: string): Promise<Event>;
  updateEvent(organizerId: string, request: UpdateEventRequest): Promise<Event>;
  deleteEvent(organizerId: string, eventId: string): Promise<void>;
  
  // Event Listing & Search
  listEvents(params?: EventSearchParams): Promise<Event[]>;
  listOrganizerEvents(organizerId: string): Promise<Event[]>;
  searchEvents(query: string, params?: EventSearchParams): Promise<Event[]>;
  
  // Event Stats
  getEventAttendeeCount(eventId: string): Promise<number>;
  getEventCapacityStatus(eventId: string): Promise<{
    total: number;
    reserved: number;
    available: number;
  }>;
  
  // Event Validation
  validateEventDates(startDateTime: Date, endDateTime: Date): Promise<void>;
  validateEventCapacity(eventId: string): Promise<void>;
  
  // Event Access
  isEventVisible(eventId: string, userId?: string): Promise<boolean>;
  canUserAccessEvent(eventId: string, userId: string): Promise<boolean>;
} 