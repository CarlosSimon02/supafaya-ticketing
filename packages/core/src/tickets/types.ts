import { z } from 'zod';

export enum TicketStatus {
  AVAILABLE = 'AVAILABLE',
  RESERVED = 'RESERVED',
  SOLD = 'SOLD',
  CANCELLED = 'CANCELLED',
}

export enum TicketApprovalStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

// Will be expanded when implementing paid tickets
export const ticketPriceSchema = z.object({
  amount: z.number().min(0),
  currency: z.string().default('PHP'), // Default to PHP for now
});

export type TicketPrice = z.infer<typeof ticketPriceSchema>;

export const ticketTypeSchema = z.object({
  id: z.string(),
  eventId: z.string(),
  name: z.string().min(1),
  description: z.string().optional(),
  price: ticketPriceSchema,
  quantity: z.number().int().positive(),
  maxPerCustomer: z.number().int().positive().default(1),
  requireApproval: z.boolean().default(false),
  // Dates
  saleStartDate: z.date().optional(),
  saleEndDate: z.date().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type TicketType = z.infer<typeof ticketTypeSchema>;

export const ticketSchema = z.object({
  id: z.string(),
  eventId: z.string(),
  ticketTypeId: z.string(),
  customerId: z.string(),
  status: z.nativeEnum(TicketStatus),
  approvalStatus: z.nativeEnum(TicketApprovalStatus).optional(),
  price: ticketPriceSchema,
  // Payment info - will be expanded later
  paymentId: z.string().optional(),
  paymentStatus: z.string().optional(),
  // Metadata
  customerName: z.string(),
  customerEmail: z.string().email(),
  // Dates
  reservedAt: z.date(),
  expiresAt: z.date().optional(), // For reservation expiry
  purchasedAt: z.date().optional(),
  cancelledAt: z.date().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type Ticket = z.infer<typeof ticketSchema>;

export interface CreateTicketTypeRequest {
  eventId: string;
  name: string;
  description?: string;
  price: TicketPrice;
  quantity: number;
  maxPerCustomer?: number;
  requireApproval?: boolean;
  saleStartDate?: Date;
  saleEndDate?: Date;
}

export interface UpdateTicketTypeRequest extends Partial<CreateTicketTypeRequest> {
  id: string;
}

export interface ReserveTicketRequest {
  ticketTypeId: string;
  quantity: number;
  customerName: string;
  customerEmail: string;
}

export interface PurchaseTicketRequest {
  reservationId: string;
  // Payment details will be added later
}

// Error types
export class TicketError extends Error {
  constructor(
    message: string,
    public code: string,
    public originalError?: unknown
  ) {
    super(message);
    this.name = 'TicketError';
  }
}

export class TicketTypeNotFoundError extends TicketError {
  constructor(ticketTypeId: string) {
    super(
      `Ticket type with ID ${ticketTypeId} not found`,
      'ticket/type-not-found'
    );
    this.name = 'TicketTypeNotFoundError';
  }
}

export class TicketNotFoundError extends TicketError {
  constructor(ticketId: string) {
    super(
      `Ticket with ID ${ticketId} not found`,
      'ticket/not-found'
    );
    this.name = 'TicketNotFoundError';
  }
}

export class TicketSoldOutError extends TicketError {
  constructor(ticketTypeId: string) {
    super(
      `Tickets of type ${ticketTypeId} are sold out`,
      'ticket/sold-out'
    );
    this.name = 'TicketSoldOutError';
  }
}

export class TicketReservationExpiredError extends TicketError {
  constructor(ticketId: string) {
    super(
      `Ticket reservation ${ticketId} has expired`,
      'ticket/reservation-expired'
    );
    this.name = 'TicketReservationExpiredError';
  }
}

export class MaxTicketsPerCustomerError extends TicketError {
  constructor(ticketTypeId: string, maxAllowed: number) {
    super(
      `Cannot purchase more than ${maxAllowed} tickets of type ${ticketTypeId}`,
      'ticket/max-per-customer-exceeded'
    );
    this.name = 'MaxTicketsPerCustomerError';
  }
} 