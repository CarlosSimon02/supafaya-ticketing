import { AuthResponse, LoginRequest, RegisterRequest, User } from './types';

export interface IAuthService {
  // Email/Password authentication
  register(request: RegisterRequest): Promise<AuthResponse>;
  login(request: LoginRequest): Promise<AuthResponse>;
  
  // Social authentication
  loginWithGoogle(): Promise<AuthResponse>;
  loginWithFacebook(): Promise<AuthResponse>;
  
  // Token management
  refreshToken(refreshToken: string): Promise<{ token: string; refreshToken: string }>;
  logout(): Promise<void>;
  
  // User management
  getCurrentUser(): Promise<User | null>;
  updateUserProfile(userId: string, updates: Partial<User>): Promise<User>;
  updateUserRoles(userId: string, roles: string[]): Promise<User>;
  
  // Email verification
  sendEmailVerification(): Promise<void>;
  verifyEmail(oobCode: string): Promise<void>;
  
  // Password management
  sendPasswordResetEmail(email: string): Promise<void>;
  confirmPasswordReset(oobCode: string, newPassword: string): Promise<void>;
} 