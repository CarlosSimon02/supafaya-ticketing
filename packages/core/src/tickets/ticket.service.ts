import {
  Ticket,
  TicketType,
  CreateTicketTypeRequest,
  UpdateTicketTypeRequest,
  ReserveTicketRequest,
  PurchaseTicketRequest,
  TicketApprovalStatus
} from './types';

export interface ITicketService {
  // Ticket Type Management
  createTicketType(organizerId: string, request: CreateTicketTypeRequest): Promise<TicketType>;
  getTicketType(ticketTypeId: string): Promise<TicketType>;
  updateTicketType(organizerId: string, request: UpdateTicketTypeRequest): Promise<TicketType>;
  deleteTicketType(organizerId: string, ticketTypeId: string): Promise<void>;
  listEventTicketTypes(eventId: string): Promise<TicketType[]>;
  
  // Ticket Purchase Flow
  reserveTickets(customerId: string, request: ReserveTicketRequest): Promise<Ticket[]>;
  purchaseTickets(customerId: string, request: PurchaseTicketRequest): Promise<Ticket[]>;
  cancelReservation(customerId: string, reservationId: string): Promise<void>;
  
  // Ticket Management
  getTicket(ticketId: string): Promise<Ticket>;
  listCustomerTickets(customerId: string): Promise<Ticket[]>;
  listEventTickets(eventId: string): Promise<Ticket[]>;
  cancelTicket(ticketId: string): Promise<Ticket>;
  
  // Ticket Approval
  approveTicket(organizerId: string, ticketId: string): Promise<Ticket>;
  rejectTicket(organizerId: string, ticketId: string): Promise<Ticket>;
  listPendingApprovals(eventId: string): Promise<Ticket[]>;
  
  // Ticket Stats
  getTicketTypeStats(ticketTypeId: string): Promise<{
    total: number;
    available: number;
    reserved: number;
    sold: number;
    cancelled: number;
  }>;
  
  // Validation
  validateTicketAvailability(ticketTypeId: string, quantity: number): Promise<void>;
  validateCustomerTicketLimit(customerId: string, ticketTypeId: string, quantity: number): Promise<void>;
  
  // Reservation Management
  cleanupExpiredReservations(): Promise<void>;
} 