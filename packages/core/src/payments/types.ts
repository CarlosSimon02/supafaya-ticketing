import { z } from 'zod';

export enum PaymentStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  REFUNDED = 'REFUNDED',
  CANCELLED = 'CANCELLED',
}

export enum PaymentProvider {
  STRIPE = 'STRIPE',
  // TODO: Add Xendit when migrating
  // XENDIT = 'XENDIT',
}

export const paymentSchema = z.object({
  id: z.string(),
  provider: z.nativeEnum(PaymentProvider),
  status: z.nativeEnum(PaymentStatus),
  amount: z.number().min(0),
  currency: z.string(),
  customerId: z.string(),
  customerEmail: z.string().email(),
  // Provider-specific IDs
  providerPaymentId: z.string(),
  providerCustomerId: z.string().optional(),
  // Metadata
  metadata: z.record(z.string()).optional(),
  // Error info
  errorMessage: z.string().optional(),
  errorCode: z.string().optional(),
  // Refund info
  refundReason: z.string().optional(),
  refundedAt: z.date().optional(),
  // Timestamps
  createdAt: z.date(),
  updatedAt: z.date(),
  completedAt: z.date().optional(),
});

export type Payment = z.infer<typeof paymentSchema>;

export interface CreatePaymentRequest {
  amount: number;
  currency: string;
  customerId: string;
  customerEmail: string;
  metadata?: Record<string, string>;
}

export interface RefundRequest {
  paymentId: string;
  reason?: string;
}

// Error types
export class PaymentError extends Error {
  constructor(
    message: string,
    public code: string,
    public originalError?: unknown
  ) {
    super(message);
    this.name = 'PaymentError';
  }
}

export class PaymentNotFoundError extends PaymentError {
  constructor(paymentId: string) {
    super(
      `Payment with ID ${paymentId} not found`,
      'payment/not-found'
    );
    this.name = 'PaymentNotFoundError';
  }
}

export class PaymentFailedError extends PaymentError {
  constructor(message: string, code: string) {
    super(message, code);
    this.name = 'PaymentFailedError';
  }
}

export class RefundError extends PaymentError {
  constructor(message: string, code: string) {
    super(message, code);
    this.name = 'RefundError';
  }
} 