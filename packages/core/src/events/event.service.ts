import { 
  Event, 
  CreateEventRequest, 
  UpdateEventRequest, 
  EventSearchParams,
  EventParticipation,
  EventParticipationType,
  EventStats,
  UserEventHistory
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
  getEventStats(eventId: string): Promise<EventStats>;
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

  // Event Participation
  registerForEvent(userId: string, eventId: string, type: EventParticipationType): Promise<EventParticipation>;
  cancelParticipation(userId: string, eventId: string): Promise<void>;
  checkInParticipant(organizerId: string, eventId: string, userId: string): Promise<EventParticipation>;
  markNoShow(organizerId: string, eventId: string, userId: string): Promise<EventParticipation>;
  
  // User Event History
  getUserEventHistory(userId: string): Promise<UserEventHistory>;
  listEventParticipants(eventId: string): Promise<EventParticipation[]>;
  getParticipation(eventId: string, userId: string): Promise<EventParticipation | null>;
  
  // Waitlist Management
  joinWaitlist(userId: string, eventId: string): Promise<EventParticipation>;
  removeFromWaitlist(userId: string, eventId: string): Promise<void>;
  getWaitlistPosition(userId: string, eventId: string): Promise<number>;
  promoteFromWaitlist(organizerId: string, eventId: string, userId: string): Promise<EventParticipation>;
} 