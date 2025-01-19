import { Firestore, Timestamp } from 'firebase-admin/firestore';
import { 
  Event,
  EventError,
  EventNotFoundError,
  InvalidEventDatesError,
  EventCapacityError,
  CreateEventRequest,
  UpdateEventRequest,
  EventSearchParams,
  eventSchema,
  EventVisibility
} from './types';
import { IEventService } from './event.service';

export class FirebaseEventService implements IEventService {
  private readonly collectionName = 'events';

  constructor(private firestore: Firestore) {}

  private async getEventDoc(eventId: string) {
    const doc = await this.firestore.collection(this.collectionName).doc(eventId).get();
    if (!doc.exists) {
      throw new EventNotFoundError(eventId);
    }
    return doc;
  }

  private convertToEvent(doc: FirebaseFirestore.DocumentSnapshot): Event {
    const data = doc.data()!;
    return eventSchema.parse({
      ...data,
      id: doc.id,
      startDateTime: data.startDateTime.toDate(),
      endDateTime: data.endDateTime.toDate(),
      createdAt: data.createdAt.toDate(),
      updatedAt: data.updatedAt.toDate(),
    });
  }

  async createEvent(organizerId: string, request: CreateEventRequest): Promise<Event> {
    try {
      await this.validateEventDates(request.startDateTime, request.endDateTime);

      const now = Timestamp.now();
      const eventData = {
        ...request,
        organizerId,
        startDateTime: Timestamp.fromDate(request.startDateTime),
        endDateTime: Timestamp.fromDate(request.endDateTime),
        createdAt: now,
        updatedAt: now,
      };

      const docRef = await this.firestore.collection(this.collectionName).add(eventData);
      const doc = await docRef.get();

      return this.convertToEvent(doc);
    } catch (error: any) {
      if (error instanceof EventError) throw error;
      throw new EventError('Failed to create event', 'event/creation-failed', error);
    }
  }

  async getEvent(eventId: string): Promise<Event> {
    try {
      const doc = await this.getEventDoc(eventId);
      return this.convertToEvent(doc);
    } catch (error: any) {
      if (error instanceof EventError) throw error;
      throw new EventError('Failed to get event', 'event/get-failed', error);
    }
  }

  async updateEvent(organizerId: string, request: UpdateEventRequest): Promise<Event> {
    try {
      const doc = await this.getEventDoc(request.id);
      const event = this.convertToEvent(doc);

      if (event.organizerId !== organizerId) {
        throw new EventError('Unauthorized event update', 'event/unauthorized');
      }

      if (request.startDateTime && request.endDateTime) {
        await this.validateEventDates(request.startDateTime, request.endDateTime);
      }

      const updateData = {
        ...request,
        startDateTime: request.startDateTime ? Timestamp.fromDate(request.startDateTime) : undefined,
        endDateTime: request.endDateTime ? Timestamp.fromDate(request.endDateTime) : undefined,
        updatedAt: Timestamp.now(),
      };

      await doc.ref.update(updateData);
      const updatedDoc = await doc.ref.get();

      return this.convertToEvent(updatedDoc);
    } catch (error: any) {
      if (error instanceof EventError) throw error;
      throw new EventError('Failed to update event', 'event/update-failed', error);
    }
  }

  async deleteEvent(organizerId: string, eventId: string): Promise<void> {
    try {
      const doc = await this.getEventDoc(eventId);
      const event = this.convertToEvent(doc);

      if (event.organizerId !== organizerId) {
        throw new EventError('Unauthorized event deletion', 'event/unauthorized');
      }

      await doc.ref.delete();
    } catch (error: any) {
      if (error instanceof EventError) throw error;
      throw new EventError('Failed to delete event', 'event/deletion-failed', error);
    }
  }

  async listEvents(params?: EventSearchParams): Promise<Event[]> {
    try {
      let query = this.firestore.collection(this.collectionName).orderBy('startDateTime');

      if (params?.startDate) {
        query = query.where('startDateTime', '>=', Timestamp.fromDate(params.startDate));
      }
      if (params?.endDate) {
        query = query.where('startDateTime', '<=', Timestamp.fromDate(params.endDate));
      }
      if (params?.organizerId) {
        query = query.where('organizerId', '==', params.organizerId);
      }
      if (params?.visibility) {
        query = query.where('visibility', '==', params.visibility);
      }
      // TODO: Implement location search when we integrate with location APIs

      const snapshot = await query.get();
      return snapshot.docs.map(doc => this.convertToEvent(doc));
    } catch (error: any) {
      throw new EventError('Failed to list events', 'event/list-failed', error);
    }
  }

  async listOrganizerEvents(organizerId: string): Promise<Event[]> {
    return this.listEvents({ organizerId });
  }

  async searchEvents(query: string, params?: EventSearchParams): Promise<Event[]> {
    // TODO: Implement full-text search (consider using Algolia or ElasticSearch)
    // For now, just return all events matching the params
    return this.listEvents(params);
  }

  async getEventAttendeeCount(eventId: string): Promise<number> {
    // TODO: Implement when we create the ticket/booking system
    return 0;
  }

  async getEventCapacityStatus(eventId: string): Promise<{ total: number; reserved: number; available: number; }> {
    const event = await this.getEvent(eventId);
    const reserved = await this.getEventAttendeeCount(eventId);
    
    return {
      total: event.capacity,
      reserved,
      available: event.capacity - reserved
    };
  }

  async validateEventDates(startDateTime: Date, endDateTime: Date): Promise<void> {
    const now = new Date();
    
    if (startDateTime < now) {
      throw new InvalidEventDatesError('Event cannot start in the past');
    }
    
    if (endDateTime <= startDateTime) {
      throw new InvalidEventDatesError('Event must end after it starts');
    }
  }

  async validateEventCapacity(eventId: string): Promise<void> {
    const status = await this.getEventCapacityStatus(eventId);
    
    if (status.available <= 0) {
      throw new EventCapacityError(eventId);
    }
  }

  async isEventVisible(eventId: string, userId?: string): Promise<boolean> {
    const event = await this.getEvent(eventId);
    
    if (event.visibility === EventVisibility.PUBLIC) {
      return true;
    }
    
    if (!userId) {
      return false;
    }
    
    // Private events are visible to organizers
    return event.organizerId === userId;
  }

  async canUserAccessEvent(eventId: string, userId: string): Promise<boolean> {
    const event = await this.getEvent(eventId);
    
    // Organizers can always access their events
    if (event.organizerId === userId) {
      return true;
    }
    
    // For private events, implement access control (e.g., invite system)
    if (event.visibility === EventVisibility.PRIVATE) {
      // TODO: Check if user is invited when we implement the invite system
      return false;
    }
    
    return true;
  }
} 