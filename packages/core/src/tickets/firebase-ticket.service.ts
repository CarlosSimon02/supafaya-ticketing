import { Firestore, Timestamp } from 'firebase-admin/firestore';
import { Redis } from 'ioredis';
import {
  Ticket,
  TicketType,
  TicketError,
  TicketTypeNotFoundError,
  TicketNotFoundError,
  TicketSoldOutError,
  MaxTicketsPerCustomerError,
  CreateTicketTypeRequest,
  UpdateTicketTypeRequest,
  ReserveTicketRequest,
  PurchaseTicketRequest,
  ticketSchema,
  ticketTypeSchema,
  TicketStatus,
  TicketApprovalStatus,
} from './types';
import { ITicketService } from './ticket.service';
import { IPaymentService, PaymentStatus } from '../payments';

export class FirebaseTicketService implements ITicketService {
  private readonly ticketTypesCollection = 'ticketTypes';
  private readonly ticketsCollection = 'tickets';
  private readonly eventsCollection = 'events';
  private readonly reservationExpiryMinutes = 15; // 15 minutes to complete purchase
  private readonly maxReservationsPerHour = 10;
  private readonly maxPurchasesPerDay = 20;
  private readonly suspiciousIpThreshold = 5;
  private readonly cacheTTL = 3600; // 1 hour cache TTL

  // Cache keys
  private getTicketTypeCacheKey(id: string) { return `ticketType:${id}`; }
  private getTicketCacheKey(id: string) { return `ticket:${id}`; }
  private getEventTicketTypesCacheKey(eventId: string) { return `event:${eventId}:ticketTypes`; }
  private getEventTicketsCacheKey(eventId: string) { return `event:${eventId}:tickets`; }
  private getCustomerTicketsCacheKey(customerId: string) { return `customer:${customerId}:tickets`; }

  constructor(
    private firestore: Firestore,
    private paymentService: IPaymentService,
    private redis: Redis
  ) {}

  // Rate limiting helpers
  private async checkRateLimit(key: string, limit: number, windowSeconds: number): Promise<boolean> {
    const count = await this.redis.incr(key);
    if (count === 1) {
      await this.redis.expire(key, windowSeconds);
    }
    return count <= limit;
  }

  private async checkReservationRateLimit(customerId: string, ip: string): Promise<void> {
    const hourKey = `reservations:${customerId}:${ip}:hour`;
    const isAllowed = await this.checkRateLimit(hourKey, this.maxReservationsPerHour, 3600);
    if (!isAllowed) {
      throw new TicketError('Too many reservation attempts', 'ticket/rate-limit-exceeded');
    }
  }

  private async checkPurchaseRateLimit(customerId: string, ip: string): Promise<void> {
    const dayKey = `purchases:${customerId}:${ip}:day`;
    const isAllowed = await this.checkRateLimit(dayKey, this.maxPurchasesPerDay, 86400);
    if (!isAllowed) {
      throw new TicketError('Too many purchase attempts', 'ticket/rate-limit-exceeded');
    }
  }

  // Fraud detection helpers
  private async checkForFraudulentActivity(customerId: string, ip: string, ticketType: TicketType): Promise<void> {
    // Check for suspicious IP activity
    const ipKey = `suspicious:ip:${ip}:count`;
    const ipCount = await this.redis.incr(ipKey);
    await this.redis.expire(ipKey, 86400); // 24 hours

    if (ipCount > this.suspiciousIpThreshold) {
      throw new TicketError('Suspicious activity detected', 'ticket/fraud-detected');
    }

    // Check for multiple different payment methods
    const paymentMethodsKey = `payment-methods:${customerId}:count`;
    const paymentMethodCount = await this.redis.get(paymentMethodsKey);
    if (paymentMethodCount && parseInt(paymentMethodCount) > 3) {
      throw new TicketError('Too many payment methods', 'ticket/fraud-detected');
    }

    // Check for high-value purchases
    if (ticketType.price.amount > 1000) {
      const highValueKey = `high-value:${customerId}:count`;
      const highValueCount = await this.redis.incr(highValueKey);
      await this.redis.expire(highValueKey, 86400);

      if (highValueCount > 2) {
        throw new TicketError('Too many high-value purchases', 'ticket/fraud-detected');
      }
    }
  }

  private async getTicketTypeDoc(ticketTypeId: string) {
    const doc = await this.firestore.collection(this.ticketTypesCollection).doc(ticketTypeId).get();
    if (!doc.exists) {
      throw new TicketTypeNotFoundError(ticketTypeId);
    }
    return doc;
  }

  private async getTicketDoc(ticketId: string) {
    const doc = await this.firestore.collection(this.ticketsCollection).doc(ticketId).get();
    if (!doc.exists) {
      throw new TicketNotFoundError(ticketId);
    }
    return doc;
  }

  private convertToTicketType(doc: FirebaseFirestore.DocumentSnapshot): TicketType {
    const data = doc.data()!;
    return ticketTypeSchema.parse({
      ...data,
      id: doc.id,
      saleStartDate: data.saleStartDate?.toDate(),
      saleEndDate: data.saleEndDate?.toDate(),
      createdAt: data.createdAt.toDate(),
      updatedAt: data.updatedAt.toDate(),
    });
  }

  private convertToTicket(doc: FirebaseFirestore.DocumentSnapshot): Ticket {
    const data = doc.data()!;
    return ticketSchema.parse({
      ...data,
      id: doc.id,
      reservedAt: data.reservedAt.toDate(),
      expiresAt: data.expiresAt?.toDate(),
      purchasedAt: data.purchasedAt?.toDate(),
      cancelledAt: data.cancelledAt?.toDate(),
      createdAt: data.createdAt.toDate(),
      updatedAt: data.updatedAt.toDate(),
    });
  }

  private async verifyOrganizerOwnsEvent(organizerId: string, eventId: string, ip?: string): Promise<void> {
    // Check rate limit for organizer operations
    if (ip) {
      const organizerOpKey = `organizer:${organizerId}:${ip}:ops`;
      const isAllowed = await this.checkRateLimit(organizerOpKey, 100, 3600);
      if (!isAllowed) {
        throw new TicketError('Too many organizer operations', 'ticket/rate-limit-exceeded');
      }
    }

    const eventDoc = await this.firestore.collection(this.eventsCollection).doc(eventId).get();
    
    if (!eventDoc.exists) {
      throw new TicketError('Event not found', 'ticket/event-not-found');
    }

    const eventData = eventDoc.data()!;

    // Check if organizer owns the event
    if (eventData.organizerId !== organizerId) {
      throw new TicketError('Unauthorized: Not the event organizer', 'ticket/unauthorized');
    }

    // Check if event is active
    const now = new Date();
    const endDateTime = eventData.endDateTime?.toDate();
    if (endDateTime && endDateTime < now) {
      throw new TicketError('Event has ended', 'ticket/event-ended');
    }

    // Check if event is published/visible
    if (eventData.visibility === 'PRIVATE' && !eventData.isPublished) {
      throw new TicketError('Event is not published', 'ticket/event-not-published');
    }

    // Check if ticket sales are allowed
    const startDateTime = eventData.startDateTime?.toDate();
    if (startDateTime && startDateTime < now) {
      throw new TicketError('Event has already started', 'ticket/event-started');
    }

    // Check if event has reached capacity
    const capacity = eventData.capacity || 0;
    if (capacity > 0) {
      const ticketsSnapshot = await this.firestore
        .collection(this.ticketsCollection)
        .where('eventId', '==', eventId)
        .where('status', '==', TicketStatus.SOLD)
        .get();

      if (ticketsSnapshot.size >= capacity) {
        throw new TicketError('Event has reached capacity', 'ticket/event-full');
      }
    }

    // Check if organizer's account is active
    const organizerDoc = await this.firestore.collection('users').doc(organizerId).get();
    if (!organizerDoc.exists) {
      throw new TicketError('Organizer account not found', 'ticket/organizer-not-found');
    }

    const organizerData = organizerDoc.data()!;
    if (organizerData.disabled || !organizerData.emailVerified) {
      throw new TicketError('Organizer account is not active', 'ticket/organizer-inactive');
    }

    // Check for suspicious organizer activity
    const suspiciousKey = `suspicious:organizer:${organizerId}:count`;
    const suspiciousCount = await this.redis.get(suspiciousKey);
    if (suspiciousCount && parseInt(suspiciousCount) > 10) {
      throw new TicketError('Suspicious organizer activity', 'ticket/suspicious-activity');
    }
  }

  // Cache helpers
  private async getCached<T>(key: string): Promise<T | null> {
    const cached = await this.redis.get(key);
    return cached ? JSON.parse(cached) : null;
  }

  private async setCache<T>(key: string, value: T): Promise<void> {
    await this.redis.setex(key, this.cacheTTL, JSON.stringify(value));
  }

  private async invalidateCache(keys: string[]): Promise<void> {
    if (keys.length > 0) {
      await this.redis.del(...keys);
    }
  }

  async getTicketType(ticketTypeId: string): Promise<TicketType> {
    try {
      // Check cache first
      const cacheKey = this.getTicketTypeCacheKey(ticketTypeId);
      const cached = await this.getCached<TicketType>(cacheKey);
      if (cached) {
        return cached;
      }

      const doc = await this.getTicketTypeDoc(ticketTypeId);
      const ticketType = this.convertToTicketType(doc);
      
      // Cache the result
      await this.setCache(cacheKey, ticketType);
      
      return ticketType;
    } catch (error: any) {
      if (error instanceof TicketError) throw error;
      throw new TicketError('Failed to get ticket type', 'ticket/get-failed', error);
    }
  }

  async getTicket(ticketId: string): Promise<Ticket> {
    try {
      // Check cache first
      const cacheKey = this.getTicketCacheKey(ticketId);
      const cached = await this.getCached<Ticket>(cacheKey);
      if (cached) {
        return cached;
      }

      const doc = await this.getTicketDoc(ticketId);
      const ticket = this.convertToTicket(doc);
      
      // Cache the result
      await this.setCache(cacheKey, ticket);
      
      return ticket;
    } catch (error: any) {
      if (error instanceof TicketError) throw error;
      throw new TicketError('Failed to get ticket', 'ticket/get-failed', error);
    }
  }

  async listEventTicketTypes(eventId: string): Promise<TicketType[]> {
    try {
      // Check cache first
      const cacheKey = this.getEventTicketTypesCacheKey(eventId);
      const cached = await this.getCached<TicketType[]>(cacheKey);
      if (cached) {
        return cached;
      }

      const snapshot = await this.firestore
        .collection(this.ticketTypesCollection)
        .where('eventId', '==', eventId)
        .get();

      const ticketTypes = snapshot.docs.map(doc => this.convertToTicketType(doc));
      
      // Cache the result
      await this.setCache(cacheKey, ticketTypes);
      
      return ticketTypes;
    } catch (error: any) {
      throw new TicketError('Failed to list ticket types', 'ticket/list-failed', error);
    }
  }

  async listCustomerTickets(customerId: string): Promise<Ticket[]> {
    try {
      // Check cache first
      const cacheKey = this.getCustomerTicketsCacheKey(customerId);
      const cached = await this.getCached<Ticket[]>(cacheKey);
      if (cached) {
        return cached;
      }

      const snapshot = await this.firestore
        .collection(this.ticketsCollection)
        .where('customerId', '==', customerId)
        .get();

      const tickets = snapshot.docs.map(doc => this.convertToTicket(doc));
      
      // Cache the result
      await this.setCache(cacheKey, tickets);
      
      return tickets;
    } catch (error: any) {
      throw new TicketError('Failed to list customer tickets', 'ticket/list-failed', error);
    }
  }

  async listEventTickets(eventId: string): Promise<Ticket[]> {
    try {
      // Check cache first
      const cacheKey = this.getEventTicketsCacheKey(eventId);
      const cached = await this.getCached<Ticket[]>(cacheKey);
      if (cached) {
        return cached;
      }

      const snapshot = await this.firestore
        .collection(this.ticketsCollection)
        .where('eventId', '==', eventId)
        .get();

      const tickets = snapshot.docs.map(doc => this.convertToTicket(doc));
      
      // Cache the result
      await this.setCache(cacheKey, tickets);
      
      return tickets;
    } catch (error: any) {
      throw new TicketError('Failed to list event tickets', 'ticket/list-failed', error);
    }
  }

  async createTicketType(organizerId: string, request: CreateTicketTypeRequest): Promise<TicketType> {
    try {
      await this.verifyOrganizerOwnsEvent(organizerId, request.eventId);

      const now = Timestamp.now();
      const ticketTypeData = {
        ...request,
        saleStartDate: request.saleStartDate ? Timestamp.fromDate(request.saleStartDate) : null,
        saleEndDate: request.saleEndDate ? Timestamp.fromDate(request.saleEndDate) : null,
        createdAt: now,
        updatedAt: now,
      };

      const docRef = await this.firestore.collection(this.ticketTypesCollection).add(ticketTypeData);
      const doc = await docRef.get();

      const result = this.convertToTicketType(doc);
      
      // Cache invalidation
      await this.invalidateCache([
        this.getEventTicketTypesCacheKey(request.eventId)
      ]);
      
      return result;
    } catch (error: any) {
      throw new TicketError('Failed to create ticket type', 'ticket/creation-failed', error);
    }
  }

  async updateTicketType(organizerId: string, request: UpdateTicketTypeRequest): Promise<TicketType> {
    try {
      const doc = await this.getTicketTypeDoc(request.id);
      const ticketType = this.convertToTicketType(doc);

      await this.verifyOrganizerOwnsEvent(organizerId, ticketType.eventId);

      const updateData = {
        ...request,
        saleStartDate: request.saleStartDate ? Timestamp.fromDate(request.saleStartDate) : undefined,
        saleEndDate: request.saleEndDate ? Timestamp.fromDate(request.saleEndDate) : undefined,
        updatedAt: Timestamp.now(),
      };

      await doc.ref.update(updateData);
      const updatedDoc = await doc.ref.get();

      const result = this.convertToTicketType(updatedDoc);
      
      // Cache invalidation
      await this.invalidateCache([
        this.getTicketTypeCacheKey(request.id),
        this.getEventTicketTypesCacheKey(result.eventId)
      ]);
      
      return result;
    } catch (error: any) {
      if (error instanceof TicketError) throw error;
      throw new TicketError('Failed to update ticket type', 'ticket/update-failed', error);
    }
  }

  async deleteTicketType(organizerId: string, ticketTypeId: string): Promise<void> {
    try {
      const ticketType = await this.getTicketType(ticketTypeId);
      await this.verifyOrganizerOwnsEvent(organizerId, ticketType.eventId);
      const doc = await this.getTicketTypeDoc(ticketTypeId);
      await doc.ref.delete();
      
      // Cache invalidation
      await this.invalidateCache([
        this.getTicketTypeCacheKey(ticketTypeId),
        this.getEventTicketTypesCacheKey(ticketType.eventId)
      ]);
    } catch (error: any) {
      if (error instanceof TicketError) throw error;
      throw new TicketError('Failed to delete ticket type', 'ticket/deletion-failed', error);
    }
  }

  async reserveTickets(customerId: string, request: ReserveTicketRequest, ip: string): Promise<Ticket[]> {
    const batch = this.firestore.batch();
    try {
      // Rate limiting and fraud checks
      await this.checkReservationRateLimit(customerId, ip);
      const ticketType = await this.getTicketType(request.ticketTypeId);
      await this.checkForFraudulentActivity(customerId, ip, ticketType);

      await this.validateTicketAvailability(request.ticketTypeId, request.quantity);
      await this.validateCustomerTicketLimit(customerId, request.ticketTypeId, request.quantity);

      const now = Timestamp.now();
      const expiresAt = Timestamp.fromMillis(now.toMillis() + this.reservationExpiryMinutes * 60 * 1000);

      const tickets: Ticket[] = [];
      for (let i = 0; i < request.quantity; i++) {
        const ticketRef = this.firestore.collection(this.ticketsCollection).doc();
        const ticketData = {
          eventId: ticketType.eventId,
          ticketTypeId: ticketType.id,
          customerId,
          status: TicketStatus.RESERVED,
          approvalStatus: ticketType.requireApproval ? TicketApprovalStatus.PENDING : undefined,
          price: ticketType.price,
          customerName: request.customerName,
          customerEmail: request.customerEmail,
          reservedAt: now,
          expiresAt,
          createdAt: now,
          updatedAt: now,
        };

        batch.set(ticketRef, ticketData);
        const ticket = ticketSchema.parse({
          ...ticketData,
          id: ticketRef.id,
          reservedAt: now.toDate(),
          expiresAt: expiresAt.toDate(),
          createdAt: now.toDate(),
          updatedAt: now.toDate(),
        });
        tickets.push(ticket);
      }

      await batch.commit();
      return tickets;
    } catch (error: any) {
      if (error instanceof TicketError) throw error;
      throw new TicketError('Failed to reserve tickets', 'ticket/reservation-failed', error);
    }
  }

  async purchaseTickets(customerId: string, request: PurchaseTicketRequest, ip: string): Promise<Ticket[]> {
    const batch = this.firestore.batch();
    try {
      // Rate limiting and fraud checks
      await this.checkPurchaseRateLimit(customerId, ip);
      const doc = await this.getTicketDoc(request.reservationId);
      const ticket = await this.getTicket(request.reservationId);
      const ticketType = await this.getTicketType(ticket.ticketTypeId);
      await this.checkForFraudulentActivity(customerId, ip, ticketType);

      // Validate reservation
      if (ticket.status !== TicketStatus.RESERVED) {
        throw new TicketError('Ticket is not reserved', 'ticket/invalid-status');
      }
      if (ticket.customerId !== customerId) {
        throw new TicketError('Unauthorized purchase', 'ticket/unauthorized');
      }

      // Check if ticket requires payment
      if (ticket.price.amount > 0) {
        // Create payment
        const payment = await this.paymentService.createPayment({
          amount: ticket.price.amount,
          currency: ticket.price.currency,
          customerId: ticket.customerId,
          customerEmail: ticket.customerEmail,
          metadata: {
            ticketId: ticket.id,
            eventId: ticket.eventId,
            ticketTypeId: ticket.ticketTypeId,
          },
        });

        // Update ticket with payment info
        await doc.ref.update({
          paymentId: payment.id,
          paymentStatus: payment.status,
          updatedAt: Timestamp.now(),
        });

        // Return the payment ID to the client for processing
        return [{ ...ticket, paymentId: payment.id }] as Ticket[];
      }

      // For free tickets, mark as purchased immediately
      const now = Timestamp.now();
      await doc.ref.update({
        status: TicketStatus.SOLD,
        purchasedAt: now,
        updatedAt: now,
      });

      return [ticket];
    } catch (error: any) {
      if (error instanceof TicketError) throw error;
      throw new TicketError('Failed to purchase tickets', 'ticket/purchase-failed', error);
    }
  }

  async cancelReservation(customerId: string, reservationId: string): Promise<void> {
    try {
      const doc = await this.getTicketDoc(reservationId);
      const ticket = await this.getTicket(reservationId);

      if (ticket.customerId !== customerId) {
        throw new TicketError('Unauthorized cancellation', 'ticket/unauthorized');
      }

      if (ticket.status !== TicketStatus.RESERVED) {
        throw new TicketError('Ticket is not reserved', 'ticket/invalid-status');
      }

      await doc.ref.update({
        status: TicketStatus.CANCELLED,
        cancelledAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      });
    } catch (error: any) {
      if (error instanceof TicketError) throw error;
      throw new TicketError('Failed to cancel reservation', 'ticket/cancellation-failed', error);
    }
  }

  async cancelTicket(ticketId: string): Promise<Ticket> {
    try {
      const doc = await this.getTicketDoc(ticketId);
      const ticket = await this.getTicket(ticketId);

      if (ticket.status === TicketStatus.CANCELLED) {
        throw new TicketError('Ticket is already cancelled', 'ticket/already-cancelled');
      }

      await doc.ref.update({
        status: TicketStatus.CANCELLED,
        cancelledAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      });

      return this.getTicket(ticketId);
    } catch (error: any) {
      if (error instanceof TicketError) throw error;
      throw new TicketError('Failed to cancel ticket', 'ticket/cancellation-failed', error);
    }
  }

  async approveTicket(organizerId: string, ticketId: string): Promise<Ticket> {
    try {
      const doc = await this.getTicketDoc(ticketId);
      const ticket = await this.getTicket(ticketId);

      await this.verifyOrganizerOwnsEvent(organizerId, ticket.eventId);

      if (!ticket.approvalStatus || ticket.approvalStatus !== TicketApprovalStatus.PENDING) {
        throw new TicketError('Ticket is not pending approval', 'ticket/invalid-status');
      }

      await doc.ref.update({
        approvalStatus: TicketApprovalStatus.APPROVED,
        updatedAt: Timestamp.now(),
      });

      return this.getTicket(ticketId);
    } catch (error: any) {
      if (error instanceof TicketError) throw error;
      throw new TicketError('Failed to approve ticket', 'ticket/approval-failed', error);
    }
  }

  async rejectTicket(organizerId: string, ticketId: string): Promise<Ticket> {
    try {
      const doc = await this.getTicketDoc(ticketId);
      const ticket = await this.getTicket(ticketId);

      await this.verifyOrganizerOwnsEvent(organizerId, ticket.eventId);

      if (!ticket.approvalStatus || ticket.approvalStatus !== TicketApprovalStatus.PENDING) {
        throw new TicketError('Ticket is not pending approval', 'ticket/invalid-status');
      }

      await doc.ref.update({
        approvalStatus: TicketApprovalStatus.REJECTED,
        status: TicketStatus.CANCELLED,
        cancelledAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      });

      return this.getTicket(ticketId);
    } catch (error: any) {
      if (error instanceof TicketError) throw error;
      throw new TicketError('Failed to reject ticket', 'ticket/rejection-failed', error);
    }
  }

  async listPendingApprovals(eventId: string): Promise<Ticket[]> {
    try {
      const snapshot = await this.firestore
        .collection(this.ticketsCollection)
        .where('eventId', '==', eventId)
        .where('approvalStatus', '==', TicketApprovalStatus.PENDING)
        .get();

      const tickets = await Promise.all(snapshot.docs.map(doc => this.getTicket(doc.id)));
      return tickets;
    } catch (error: any) {
      throw new TicketError('Failed to list pending approvals', 'ticket/list-failed', error);
    }
  }

  async getTicketTypeStats(ticketTypeId: string): Promise<{ total: number; available: number; reserved: number; sold: number; cancelled: number; }> {
    try {
      const ticketType = await this.getTicketType(ticketTypeId);
      const snapshot = await this.firestore
        .collection(this.ticketsCollection)
        .where('ticketTypeId', '==', ticketTypeId)
        .get();

      const stats = {
        total: ticketType.quantity,
        reserved: 0,
        sold: 0,
        cancelled: 0,
        available: 0,
      };

      for (const doc of snapshot.docs) {
        const ticket = await this.getTicket(doc.id);
        switch (ticket.status) {
          case TicketStatus.RESERVED:
            stats.reserved++;
            break;
          case TicketStatus.SOLD:
            stats.sold++;
            break;
          case TicketStatus.CANCELLED:
            stats.cancelled++;
            break;
        }
      }

      stats.available = stats.total - stats.reserved - stats.sold;
      return stats;
    } catch (error: any) {
      if (error instanceof TicketError) throw error;
      throw new TicketError('Failed to get ticket type stats', 'ticket/stats-failed', error);
    }
  }

  async validateTicketAvailability(ticketTypeId: string, quantity: number): Promise<void> {
    const stats = await this.getTicketTypeStats(ticketTypeId);
    if (stats.available < quantity) {
      throw new TicketSoldOutError(ticketTypeId);
    }
  }

  async validateCustomerTicketLimit(customerId: string, ticketTypeId: string, quantity: number): Promise<void> {
    try {
      const ticketType = await this.getTicketType(ticketTypeId);
      const snapshot = await this.firestore
        .collection(this.ticketsCollection)
        .where('ticketTypeId', '==', ticketTypeId)
        .where('customerId', '==', customerId)
        .where('status', 'in', [TicketStatus.RESERVED, TicketStatus.SOLD])
        .get();

      const currentCount = snapshot.size;
      if (currentCount + quantity > ticketType.maxPerCustomer) {
        throw new MaxTicketsPerCustomerError(ticketTypeId, ticketType.maxPerCustomer);
      }
    } catch (error: any) {
      if (error instanceof TicketError) throw error;
      throw new TicketError('Failed to validate customer ticket limit', 'ticket/validation-failed', error);
    }
  }

  async cleanupExpiredReservations(): Promise<void> {
    try {
      const now = Timestamp.now();
      const snapshot = await this.firestore
        .collection(this.ticketsCollection)
        .where('status', '==', TicketStatus.RESERVED)
        .where('expiresAt', '<=', now)
        .get();

      const batch = this.firestore.batch();
      const tickets = await Promise.all(snapshot.docs.map(doc => this.getTicket(doc.id)));
      
      for (const ticket of tickets) {
        const docRef = this.firestore.collection(this.ticketsCollection).doc(ticket.id);
        batch.update(docRef, {
          status: TicketStatus.CANCELLED,
          cancelledAt: now,
          updatedAt: now,
        });
      }

      await batch.commit();

      // Invalidate caches
      const cacheKeys = tickets.flatMap(ticket => [
        this.getTicketCacheKey(ticket.id),
        this.getEventTicketsCacheKey(ticket.eventId),
        this.getCustomerTicketsCacheKey(ticket.customerId)
      ]);
      await this.invalidateCache(cacheKeys);
    } catch (error: any) {
      throw new TicketError('Failed to cleanup expired reservations', 'ticket/cleanup-failed', error);
    }
  }

  // Add method to handle payment webhook
  async handlePaymentWebhook(paymentId: string, status: PaymentStatus): Promise<void> {
    try {
      const snapshot = await this.firestore
        .collection(this.ticketsCollection)
        .where('paymentId', '==', paymentId)
        .limit(1)
        .get();

      const doc = snapshot.docs[0];
      if (doc) {
        const now = Timestamp.now();
        const updates: any = {
          paymentStatus: status,
          updatedAt: now,
        };

        if (status === PaymentStatus.COMPLETED) {
          updates.status = TicketStatus.SOLD;
          updates.purchasedAt = now;
        } else if (status === PaymentStatus.FAILED || status === PaymentStatus.CANCELLED) {
          updates.status = TicketStatus.CANCELLED;
          updates.cancelledAt = now;
        }

        await doc.ref.update(updates);
      }
    } catch (error: any) {
      throw new TicketError('Failed to handle payment webhook', 'ticket/webhook-failed', error);
    }
  }
} 