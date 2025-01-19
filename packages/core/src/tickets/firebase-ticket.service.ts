import { Firestore, Timestamp } from 'firebase-admin/firestore';
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
  private readonly reservationExpiryMinutes = 15; // 15 minutes to complete purchase

  constructor(
    private firestore: Firestore,
    private paymentService: IPaymentService
  ) {}

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

  async createTicketType(organizerId: string, request: CreateTicketTypeRequest): Promise<TicketType> {
    try {
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

      return this.convertToTicketType(doc);
    } catch (error: any) {
      throw new TicketError('Failed to create ticket type', 'ticket/creation-failed', error);
    }
  }

  async getTicketType(ticketTypeId: string): Promise<TicketType> {
    try {
      const doc = await this.getTicketTypeDoc(ticketTypeId);
      return this.convertToTicketType(doc);
    } catch (error: any) {
      if (error instanceof TicketError) throw error;
      throw new TicketError('Failed to get ticket type', 'ticket/get-failed', error);
    }
  }

  async updateTicketType(organizerId: string, request: UpdateTicketTypeRequest): Promise<TicketType> {
    try {
      const doc = await this.getTicketTypeDoc(request.id);
      const ticketType = this.convertToTicketType(doc);

      // TODO: Verify organizer owns the event

      const updateData = {
        ...request,
        saleStartDate: request.saleStartDate ? Timestamp.fromDate(request.saleStartDate) : undefined,
        saleEndDate: request.saleEndDate ? Timestamp.fromDate(request.saleEndDate) : undefined,
        updatedAt: Timestamp.now(),
      };

      await doc.ref.update(updateData);
      const updatedDoc = await doc.ref.get();

      return this.convertToTicketType(updatedDoc);
    } catch (error: any) {
      if (error instanceof TicketError) throw error;
      throw new TicketError('Failed to update ticket type', 'ticket/update-failed', error);
    }
  }

  async deleteTicketType(organizerId: string, ticketTypeId: string): Promise<void> {
    try {
      const doc = await this.getTicketTypeDoc(ticketTypeId);
      // TODO: Verify organizer owns the event
      await doc.ref.delete();
    } catch (error: any) {
      if (error instanceof TicketError) throw error;
      throw new TicketError('Failed to delete ticket type', 'ticket/deletion-failed', error);
    }
  }

  async listEventTicketTypes(eventId: string): Promise<TicketType[]> {
    try {
      const snapshot = await this.firestore
        .collection(this.ticketTypesCollection)
        .where('eventId', '==', eventId)
        .get();

      return snapshot.docs.map(doc => this.convertToTicketType(doc));
    } catch (error: any) {
      throw new TicketError('Failed to list ticket types', 'ticket/list-failed', error);
    }
  }

  async reserveTickets(customerId: string, request: ReserveTicketRequest): Promise<Ticket[]> {
    const batch = this.firestore.batch();
    try {
      await this.validateTicketAvailability(request.ticketTypeId, request.quantity);
      await this.validateCustomerTicketLimit(customerId, request.ticketTypeId, request.quantity);

      const ticketType = await this.getTicketType(request.ticketTypeId);
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

  async purchaseTickets(customerId: string, request: PurchaseTicketRequest): Promise<Ticket[]> {
    const batch = this.firestore.batch();
    try {
      // Get the reservation
      const doc = await this.getTicketDoc(request.reservationId);
      const ticket = this.convertToTicket(doc);

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
      const ticket = this.convertToTicket(doc);

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

  async getTicket(ticketId: string): Promise<Ticket> {
    try {
      const doc = await this.getTicketDoc(ticketId);
      return this.convertToTicket(doc);
    } catch (error: any) {
      if (error instanceof TicketError) throw error;
      throw new TicketError('Failed to get ticket', 'ticket/get-failed', error);
    }
  }

  async listCustomerTickets(customerId: string): Promise<Ticket[]> {
    try {
      const snapshot = await this.firestore
        .collection(this.ticketsCollection)
        .where('customerId', '==', customerId)
        .get();

      return snapshot.docs.map(doc => this.convertToTicket(doc));
    } catch (error: any) {
      throw new TicketError('Failed to list customer tickets', 'ticket/list-failed', error);
    }
  }

  async listEventTickets(eventId: string): Promise<Ticket[]> {
    try {
      const snapshot = await this.firestore
        .collection(this.ticketsCollection)
        .where('eventId', '==', eventId)
        .get();

      return snapshot.docs.map(doc => this.convertToTicket(doc));
    } catch (error: any) {
      throw new TicketError('Failed to list event tickets', 'ticket/list-failed', error);
    }
  }

  async cancelTicket(ticketId: string): Promise<Ticket> {
    try {
      const doc = await this.getTicketDoc(ticketId);
      const ticket = this.convertToTicket(doc);

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
      const ticket = this.convertToTicket(doc);

      // TODO: Verify organizer owns the event

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
      const ticket = this.convertToTicket(doc);

      // TODO: Verify organizer owns the event

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

      return snapshot.docs.map(doc => this.convertToTicket(doc));
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

      snapshot.docs.forEach(doc => {
        const ticket = this.convertToTicket(doc);
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
      });

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
      snapshot.docs.forEach(doc => {
        batch.update(doc.ref, {
          status: TicketStatus.CANCELLED,
          cancelledAt: now,
          updatedAt: now,
        });
      });

      await batch.commit();
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