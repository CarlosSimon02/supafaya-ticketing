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
  EventVisibility,
  EventParticipation,
  EventParticipationType,
  EventParticipationStatus,
  EventStats,
  UserEventHistory,
  eventParticipationSchema
} from './types';
import { IEventService } from './event.service';

export class FirebaseEventService implements IEventService {
  private readonly collectionName = 'events';
  private readonly participationsCollection = 'eventParticipations';

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
      let query = this.firestore.collection(this.collectionName).where('isPublished', '==', true);

      if (params) {
        if (params.startDate) {
          query = query.where('startDateTime', '>=', params.startDate);
        }
        if (params.endDate) {
          query = query.where('endDateTime', '<=', params.endDate);
        }
        if (params.location) {
          query = query.where('location', '==', params.location);
        }
        if (params.status) {
          query = query.where('status', '==', params.status);
        }
        if (params.visibility) {
          query = query.where('visibility', '==', params.visibility);
        }
        if (params.categories && params.categories.length > 0) {
          query = query.where('categories', 'array-contains-any', params.categories);
        }
        if (params.tags && params.tags.length > 0) {
          query = query.where('tags', 'array-contains-any', params.tags);
        }
        if (params.limit) {
          query = query.limit(params.limit);
        }
        if (params.offset) {
          query = query.offset(params.offset);
        }
      }

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

  // Event Stats
  async getEventStats(eventId: string): Promise<EventStats> {
    try {
      const snapshot = await this.firestore
        .collection(this.participationsCollection)
        .where('eventId', '==', eventId)
        .get();

      const stats: EventStats = {
        totalParticipants: 0,
        checkedIn: 0,
        cancelled: 0,
        noShow: 0,
        waitlist: 0
      };

      snapshot.docs.forEach(doc => {
        const participation = doc.data();
        stats.totalParticipants++;

        switch (participation.status) {
          case EventParticipationStatus.CONFIRMED:
            stats.checkedIn++;
            break;
          case EventParticipationStatus.CANCELLED:
            stats.cancelled++;
            break;
          case EventParticipationStatus.NO_SHOW:
            stats.noShow++;
            break;
        }

        if (participation.type === EventParticipationType.WAITLIST) {
          stats.waitlist++;
        }
      });

      return stats;
    } catch (error: any) {
      throw new EventError('Failed to get event stats', 'event/stats-failed', error);
    }
  }

  // Event Participation
  async registerForEvent(userId: string, eventId: string, type: EventParticipationType): Promise<EventParticipation> {
    try {
      const event = await this.getEvent(eventId);
      
      // Check if user is already registered
      const existingParticipation = await this.getParticipation(eventId, userId);
      if (existingParticipation) {
        throw new EventError('Already registered for event', 'event/already-registered');
      }

      // Check event capacity for non-waitlist registrations
      if (type !== EventParticipationType.WAITLIST) {
        const stats = await this.getEventStats(eventId);
        const activeParticipants = stats.totalParticipants - stats.cancelled - stats.waitlist;
        
        if (activeParticipants >= event.capacity) {
          throw new EventError('Event is at capacity', 'event/capacity-reached');
        }
      }

      const now = Timestamp.now();
      const participationData = {
        eventId,
        userId,
        type,
        status: EventParticipationStatus.REGISTERED,
        registeredAt: now,
        createdAt: now,
        updatedAt: now,
      };

      const docRef = await this.firestore
        .collection(this.participationsCollection)
        .add(participationData);

      const doc = await docRef.get();
      return this.convertToEventParticipation(doc);
    } catch (error: any) {
      if (error instanceof EventError) throw error;
      throw new EventError('Failed to register for event', 'event/registration-failed', error);
    }
  }

  async cancelParticipation(userId: string, eventId: string): Promise<void> {
    try {
      const participation = await this.getParticipation(eventId, userId);
      if (!participation) {
        throw new EventError('Not registered for event', 'event/not-registered');
      }

      const now = Timestamp.now();
      await this.firestore
        .collection(this.participationsCollection)
        .doc(participation.id)
        .update({
          status: EventParticipationStatus.CANCELLED,
          cancelledAt: now,
          updatedAt: now,
        });
    } catch (error: any) {
      if (error instanceof EventError) throw error;
      throw new EventError('Failed to cancel participation', 'event/cancellation-failed', error);
    }
  }

  async checkInParticipant(organizerId: string, eventId: string, userId: string): Promise<EventParticipation> {
    try {
      const event = await this.getEvent(eventId);
      if (event.organizerId !== organizerId) {
        throw new EventError('Unauthorized', 'event/unauthorized');
      }

      const participation = await this.getParticipation(eventId, userId);
      if (!participation) {
        throw new EventError('Not registered for event', 'event/not-registered');
      }

      if (participation.status !== EventParticipationStatus.REGISTERED) {
        throw new EventError('Invalid participation status', 'event/invalid-status');
      }

      const now = Timestamp.now();
      await this.firestore
        .collection(this.participationsCollection)
        .doc(participation.id)
        .update({
          status: EventParticipationStatus.CONFIRMED,
          checkedInAt: now,
          updatedAt: now,
        });

      return this.getParticipation(eventId, userId) as Promise<EventParticipation>;
    } catch (error: any) {
      if (error instanceof EventError) throw error;
      throw new EventError('Failed to check in participant', 'event/check-in-failed', error);
    }
  }

  async markNoShow(organizerId: string, eventId: string, userId: string): Promise<EventParticipation> {
    try {
      const event = await this.getEvent(eventId);
      if (event.organizerId !== organizerId) {
        throw new EventError('Unauthorized', 'event/unauthorized');
      }

      const participation = await this.getParticipation(eventId, userId);
      if (!participation) {
        throw new EventError('Not registered for event', 'event/not-registered');
      }

      const now = Timestamp.now();
      await this.firestore
        .collection(this.participationsCollection)
        .doc(participation.id)
        .update({
          status: EventParticipationStatus.NO_SHOW,
          updatedAt: now,
        });

      return this.getParticipation(eventId, userId) as Promise<EventParticipation>;
    } catch (error: any) {
      if (error instanceof EventError) throw error;
      throw new EventError('Failed to mark no-show', 'event/no-show-failed', error);
    }
  }

  // User Event History
  async getUserEventHistory(userId: string): Promise<UserEventHistory> {
    try {
      const now = new Date();
      const snapshot = await this.firestore
        .collection(this.participationsCollection)
        .where('userId', '==', userId)
        .get();

      const participations = await Promise.all(
        snapshot.docs.map(async doc => {
          const participation = this.convertToEventParticipation(doc);
          const event = await this.getEvent(participation.eventId);
          return { event, participation };
        })
      );

      return {
        upcoming: participations.filter(
          ({ event, participation }) => 
            event.startDateTime > now && 
            participation.status === EventParticipationStatus.REGISTERED
        ),
        past: participations.filter(
          ({ event }) => event.endDateTime < now
        ),
        waitlist: participations.filter(
          ({ participation }) => 
            participation.type === EventParticipationType.WAITLIST &&
            participation.status === EventParticipationStatus.REGISTERED
        ),
      };
    } catch (error: any) {
      throw new EventError('Failed to get user event history', 'event/history-failed', error);
    }
  }

  async listEventParticipants(eventId: string): Promise<EventParticipation[]> {
    try {
      const snapshot = await this.firestore
        .collection(this.participationsCollection)
        .where('eventId', '==', eventId)
        .get();

      return snapshot.docs.map(doc => this.convertToEventParticipation(doc));
    } catch (error: any) {
      throw new EventError('Failed to list event participants', 'event/list-failed', error);
    }
  }

  async getParticipation(eventId: string, userId: string): Promise<EventParticipation | null> {
    try {
      const snapshot = await this.firestore
        .collection(this.participationsCollection)
        .where('eventId', '==', eventId)
        .where('userId', '==', userId)
        .limit(1)
        .get();

      if (snapshot.empty || !snapshot.docs[0]) {
        return null;
      }

      return this.convertToEventParticipation(snapshot.docs[0]);
    } catch (error: any) {
      throw new EventError('Failed to get participation', 'event/get-failed', error);
    }
  }

  // Waitlist Management
  async joinWaitlist(userId: string, eventId: string): Promise<EventParticipation> {
    return this.registerForEvent(userId, eventId, EventParticipationType.WAITLIST);
  }

  async removeFromWaitlist(userId: string, eventId: string): Promise<void> {
    return this.cancelParticipation(userId, eventId);
  }

  async getWaitlistPosition(userId: string, eventId: string): Promise<number> {
    try {
      const participation = await this.getParticipation(eventId, userId);
      if (!participation || participation.type !== EventParticipationType.WAITLIST) {
        return -1;
      }

      const snapshot = await this.firestore
        .collection(this.participationsCollection)
        .where('eventId', '==', eventId)
        .where('type', '==', EventParticipationType.WAITLIST)
        .where('status', '==', EventParticipationStatus.REGISTERED)
        .orderBy('registeredAt')
        .get();

      const position = snapshot.docs.findIndex(doc => doc.id === participation.id);
      return position + 1;
    } catch (error: any) {
      throw new EventError('Failed to get waitlist position', 'event/waitlist-failed', error);
    }
  }

  async promoteFromWaitlist(organizerId: string, eventId: string, userId: string): Promise<EventParticipation> {
    try {
      const event = await this.getEvent(eventId);
      if (event.organizerId !== organizerId) {
        throw new EventError('Unauthorized', 'event/unauthorized');
      }

      const participation = await this.getParticipation(eventId, userId);
      if (!participation || participation.type !== EventParticipationType.WAITLIST) {
        throw new EventError('Not on waitlist', 'event/not-waitlisted');
      }

      const now = Timestamp.now();
      await this.firestore
        .collection(this.participationsCollection)
        .doc(participation.id)
        .update({
          type: EventParticipationType.FREE,
          updatedAt: now,
        });

      return this.getParticipation(eventId, userId) as Promise<EventParticipation>;
    } catch (error: any) {
      if (error instanceof EventError) throw error;
      throw new EventError('Failed to promote from waitlist', 'event/promotion-failed', error);
    }
  }

  private convertToEventParticipation(doc: FirebaseFirestore.DocumentSnapshot): EventParticipation {
    const data = doc.data()!;
    return eventParticipationSchema.parse({
      ...data,
      id: doc.id,
      registeredAt: data.registeredAt.toDate(),
      checkedInAt: data.checkedInAt?.toDate(),
      cancelledAt: data.cancelledAt?.toDate(),
      createdAt: data.createdAt.toDate(),
      updatedAt: data.updatedAt.toDate(),
    });
  }
} 