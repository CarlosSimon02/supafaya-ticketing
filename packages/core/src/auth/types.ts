import { z } from 'zod';

export enum UserRole {
  USER = 'USER',
  ORGANIZER = 'ORGANIZER',
  CUSTOMER = 'CUSTOMER',
  // Future roles - commented out for now
  // SPONSOR = 'SPONSOR',
  // ADMIN = 'ADMIN',
}

export const userSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  displayName: z.string().optional(),
  photoURL: z.string().url().optional(),
  roles: z.array(z.nativeEnum(UserRole)).default([UserRole.USER]),
  createdAt: z.date(),
  updatedAt: z.date(),
  // Auth provider specific fields
  emailVerified: z.boolean().default(false),
  phoneNumber: z.string().optional(),
  // Provider specific data
  providerData: z.array(z.object({
    providerId: z.string(),
    uid: z.string(),
    displayName: z.string().optional(),
    email: z.string().optional(),
    phoneNumber: z.string().optional(),
    photoURL: z.string().optional(),
  })).optional(),
});

export type User = z.infer<typeof userSchema>;

export const authProviderSchema = z.enum(['password', 'google.com', 'facebook.com']);
export type AuthProvider = z.infer<typeof authProviderSchema>;

export interface AuthResponse {
  user: User;
  token: string;
  refreshToken: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  displayName?: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

// Error types
export class AuthError extends Error {
  constructor(
    message: string,
    public code: string,
    public originalError?: unknown
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

export class EmailAlreadyExistsError extends AuthError {
  constructor(email: string) {
    super(
      `Email ${email} is already registered`,
      'auth/email-already-exists'
    );
    this.name = 'EmailAlreadyExistsError';
  }
}

export class InvalidCredentialsError extends AuthError {
  constructor() {
    super(
      'Invalid email or password',
      'auth/invalid-credentials'
    );
    this.name = 'InvalidCredentialsError';
  }
} 