import { CreatePaymentRequest, Payment, RefundRequest } from './types';

export interface IPaymentService {
  // Payment Flow
  createPayment(request: CreatePaymentRequest): Promise<Payment>;
  confirmPayment(paymentId: string): Promise<Payment>;
  cancelPayment(paymentId: string): Promise<Payment>;
  
  // Payment Management
  getPayment(paymentId: string): Promise<Payment>;
  listCustomerPayments(customerId: string): Promise<Payment[]>;
  
  // Refunds
  refundPayment(request: RefundRequest): Promise<Payment>;
  
  // Customer Management
  createCustomer(customerId: string, email: string): Promise<string>; // Returns provider's customer ID
  deleteCustomer(customerId: string): Promise<void>;
  
  // Webhooks
  handleWebhook(body: any, signature: string): Promise<void>;
} 