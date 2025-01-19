import { Stripe } from 'stripe';
import { Firestore, Timestamp } from 'firebase-admin/firestore';
import {
  Payment,
  PaymentError,
  PaymentFailedError,
  PaymentNotFoundError,
  RefundError,
  CreatePaymentRequest,
  RefundRequest,
  PaymentStatus,
  PaymentProvider,
  paymentSchema,
} from './types';
import { IPaymentService } from './payment.service';

// TODO: This service will be replaced with Xendit implementation
// Keep the interface and types consistent to make migration easier
export class StripePaymentService implements IPaymentService {
  private readonly paymentsCollection = 'payments';
  private readonly customerIdField = 'stripeCustomerId'; // Will be xenditCustomerId when migrated

  constructor(
    private stripe: Stripe,
    private firestore: Firestore,
    private webhookSecret: string
  ) {}

  private async getPaymentDoc(paymentId: string) {
    const doc = await this.firestore.collection(this.paymentsCollection).doc(paymentId).get();
    if (!doc.exists) {
      throw new PaymentNotFoundError(paymentId);
    }
    return doc;
  }

  private convertToPayment(doc: FirebaseFirestore.DocumentSnapshot): Payment {
    const data = doc.data()!;
    return paymentSchema.parse({
      ...data,
      id: doc.id,
      refundedAt: data.refundedAt?.toDate(),
      createdAt: data.createdAt.toDate(),
      updatedAt: data.updatedAt.toDate(),
      completedAt: data.completedAt?.toDate(),
    });
  }

  async createPayment(request: CreatePaymentRequest): Promise<Payment> {
    try {
      // Get or create Stripe customer
      const providerCustomerId = await this.createCustomer(request.customerId, request.customerEmail);

      // Create payment intent
      const paymentIntent = await this.stripe.paymentIntents.create({
        amount: Math.round(request.amount * 100), // Convert to cents
        currency: request.currency.toLowerCase(),
        customer: providerCustomerId,
        metadata: {
          ...request.metadata,
          customerId: request.customerId,
        },
      });

      // Store payment record
      const now = Timestamp.now();
      const paymentData = {
        provider: PaymentProvider.STRIPE,
        status: PaymentStatus.PENDING,
        amount: request.amount,
        currency: request.currency,
        customerId: request.customerId,
        customerEmail: request.customerEmail,
        providerPaymentId: paymentIntent.id,
        providerCustomerId,
        metadata: request.metadata,
        createdAt: now,
        updatedAt: now,
      };

      const docRef = await this.firestore.collection(this.paymentsCollection).add(paymentData);
      const doc = await docRef.get();

      return this.convertToPayment(doc);
    } catch (error: any) {
      throw new PaymentError(
        'Failed to create payment',
        'payment/creation-failed',
        error
      );
    }
  }

  async confirmPayment(paymentId: string): Promise<Payment> {
    try {
      const doc = await this.getPaymentDoc(paymentId);
      const payment = this.convertToPayment(doc);

      const paymentIntent = await this.stripe.paymentIntents.retrieve(payment.providerPaymentId);
      
      if (paymentIntent.status === 'succeeded') {
        const now = Timestamp.now();
        await doc.ref.update({
          status: PaymentStatus.COMPLETED,
          completedAt: now,
          updatedAt: now,
        });
      } else if (paymentIntent.status === 'requires_payment_method' || paymentIntent.status === 'requires_confirmation') {
        await doc.ref.update({
          status: PaymentStatus.PENDING,
          updatedAt: Timestamp.now(),
        });
      } else {
        await doc.ref.update({
          status: PaymentStatus.FAILED,
          errorMessage: `Payment failed with status: ${paymentIntent.status}`,
          errorCode: 'payment/stripe-status-' + paymentIntent.status,
          updatedAt: Timestamp.now(),
        });
      }

      return this.getPayment(paymentId);
    } catch (error: any) {
      throw new PaymentError(
        'Failed to confirm payment',
        'payment/confirmation-failed',
        error
      );
    }
  }

  async cancelPayment(paymentId: string): Promise<Payment> {
    try {
      const doc = await this.getPaymentDoc(paymentId);
      const payment = this.convertToPayment(doc);

      if (payment.status === PaymentStatus.COMPLETED) {
        throw new PaymentError(
          'Cannot cancel completed payment',
          'payment/already-completed'
        );
      }

      await this.stripe.paymentIntents.cancel(payment.providerPaymentId);
      
      await doc.ref.update({
        status: PaymentStatus.CANCELLED,
        updatedAt: Timestamp.now(),
      });

      return this.getPayment(paymentId);
    } catch (error: any) {
      throw new PaymentError(
        'Failed to cancel payment',
        'payment/cancellation-failed',
        error
      );
    }
  }

  async getPayment(paymentId: string): Promise<Payment> {
    try {
      const doc = await this.getPaymentDoc(paymentId);
      return this.convertToPayment(doc);
    } catch (error: any) {
      if (error instanceof PaymentError) throw error;
      throw new PaymentError(
        'Failed to get payment',
        'payment/get-failed',
        error
      );
    }
  }

  async listCustomerPayments(customerId: string): Promise<Payment[]> {
    try {
      const snapshot = await this.firestore
        .collection(this.paymentsCollection)
        .where('customerId', '==', customerId)
        .orderBy('createdAt', 'desc')
        .get();

      return snapshot.docs.map(doc => this.convertToPayment(doc));
    } catch (error: any) {
      throw new PaymentError(
        'Failed to list customer payments',
        'payment/list-failed',
        error
      );
    }
  }

  async refundPayment(request: RefundRequest): Promise<Payment> {
    try {
      const doc = await this.getPaymentDoc(request.paymentId);
      const payment = this.convertToPayment(doc);

      if (payment.status !== PaymentStatus.COMPLETED) {
        throw new RefundError(
          'Can only refund completed payments',
          'payment/invalid-status'
        );
      }

      const refund = await this.stripe.refunds.create({
        payment_intent: payment.providerPaymentId,
        reason: request.reason as Stripe.RefundCreateParams.Reason || 'requested_by_customer',
      });

      if (refund.status !== 'succeeded') {
        throw new RefundError(
          `Refund failed with status: ${refund.status}`,
          'payment/refund-failed'
        );
      }

      const now = Timestamp.now();
      await doc.ref.update({
        status: PaymentStatus.REFUNDED,
        refundReason: request.reason,
        refundedAt: now,
        updatedAt: now,
      });

      return this.getPayment(request.paymentId);
    } catch (error: any) {
      if (error instanceof PaymentError) throw error;
      throw new PaymentError(
        'Failed to refund payment',
        'payment/refund-failed',
        error
      );
    }
  }

  async createCustomer(customerId: string, email: string): Promise<string> {
    try {
      // Check if customer already exists
      const userDoc = await this.firestore.collection('users').doc(customerId).get();
      const existingCustomerId = userDoc.get(this.customerIdField);

      if (existingCustomerId) {
        return existingCustomerId;
      }

      // Create new Stripe customer
      const customer = await this.stripe.customers.create({
        email,
        metadata: {
          customerId,
        },
      });

      // Store Stripe customer ID
      await userDoc.ref.update({
        [this.customerIdField]: customer.id,
      });

      return customer.id;
    } catch (error: any) {
      throw new PaymentError(
        'Failed to create customer',
        'payment/customer-creation-failed',
        error
      );
    }
  }

  async deleteCustomer(customerId: string): Promise<void> {
    try {
      const userDoc = await this.firestore.collection('users').doc(customerId).get();
      const stripeCustomerId = userDoc.get(this.customerIdField);

      if (stripeCustomerId) {
        await this.stripe.customers.del(stripeCustomerId);
        await userDoc.ref.update({
          [this.customerIdField]: null,
        });
      }
    } catch (error: any) {
      throw new PaymentError(
        'Failed to delete customer',
        'payment/customer-deletion-failed',
        error
      );
    }
  }

  async handleWebhook(body: any, signature: string): Promise<void> {
    try {
      const event = this.stripe.webhooks.constructEvent(
        body,
        signature,
        this.webhookSecret
      );

      // Handle webhook events
      switch (event.type) {
        case 'payment_intent.succeeded':
          await this.handlePaymentSucceeded(event.data.object as Stripe.PaymentIntent);
          break;
        case 'payment_intent.payment_failed':
          await this.handlePaymentFailed(event.data.object as Stripe.PaymentIntent);
          break;
        // Add more event handlers as needed
      }
    } catch (error: any) {
      throw new PaymentError(
        'Failed to handle webhook',
        'payment/webhook-failed',
        error
      );
    }
  }

  private async handlePaymentSucceeded(paymentIntent: Stripe.PaymentIntent): Promise<void> {
    const snapshot = await this.firestore
      .collection(this.paymentsCollection)
      .where('providerPaymentId', '==', paymentIntent.id)
      .limit(1)
      .get();

    const doc = snapshot.docs[0];
    if (doc) {
      const now = Timestamp.now();
      await doc.ref.update({
        status: PaymentStatus.COMPLETED,
        completedAt: now,
        updatedAt: now,
      });
    }
  }

  private async handlePaymentFailed(paymentIntent: Stripe.PaymentIntent): Promise<void> {
    const snapshot = await this.firestore
      .collection(this.paymentsCollection)
      .where('providerPaymentId', '==', paymentIntent.id)
      .limit(1)
      .get();

    const doc = snapshot.docs[0];
    if (doc) {
      await doc.ref.update({
        status: PaymentStatus.FAILED,
        errorMessage: paymentIntent.last_payment_error?.message || 'Payment failed',
        errorCode: paymentIntent.last_payment_error?.code || 'payment/unknown-error',
        updatedAt: Timestamp.now(),
      });
    }
  }
} 