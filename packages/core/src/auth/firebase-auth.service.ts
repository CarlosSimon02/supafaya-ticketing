import { 
  Auth,
  GoogleAuthProvider,
  FacebookAuthProvider,
  signInWithPopup,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendEmailVerification as fbSendEmailVerification,
  sendPasswordResetEmail as fbSendPasswordResetEmail,
  verifyPasswordResetCode,
  confirmPasswordReset as fbConfirmPasswordReset,
  signOut,
  User as FirebaseUser,
  updateProfile
} from 'firebase/auth';

import { 
  AuthError,
  AuthResponse, 
  EmailAlreadyExistsError, 
  InvalidCredentialsError, 
  LoginRequest, 
  RegisterRequest, 
  User,
  userSchema 
} from './types';
import { IAuthService } from './auth.service';

export class FirebaseAuthService implements IAuthService {
  private googleProvider: GoogleAuthProvider;
  private facebookProvider: FacebookAuthProvider;

  constructor(private auth: Auth) {
    this.googleProvider = new GoogleAuthProvider();
    this.facebookProvider = new FacebookAuthProvider();
  }

  private async firebaseUserToUser(firebaseUser: FirebaseUser): Promise<User> {
    const userData = {
      id: firebaseUser.uid,
      email: firebaseUser.email!,
      displayName: firebaseUser.displayName || undefined,
      photoURL: firebaseUser.photoURL || undefined,
      emailVerified: firebaseUser.emailVerified,
      phoneNumber: firebaseUser.phoneNumber || undefined,
      providerData: firebaseUser.providerData,
      createdAt: new Date(firebaseUser.metadata.creationTime!),
      updatedAt: new Date(firebaseUser.metadata.lastSignInTime!),
    };

    return userSchema.parse(userData);
  }

  private async getAuthResponse(firebaseUser: FirebaseUser): Promise<AuthResponse> {
    const token = await firebaseUser.getIdToken();
    const refreshToken = firebaseUser.refreshToken;
    const user = await this.firebaseUserToUser(firebaseUser);

    return {
      user,
      token,
      refreshToken
    };
  }

  async register(request: RegisterRequest): Promise<AuthResponse> {
    try {
      const userCredential = await createUserWithEmailAndPassword(
        this.auth,
        request.email,
        request.password
      );

      if (request.displayName) {
        await updateProfile(userCredential.user, { displayName: request.displayName });
      }

      return this.getAuthResponse(userCredential.user);
    } catch (error: any) {
      if (error.code === 'auth/email-already-in-use') {
        throw new EmailAlreadyExistsError(request.email);
      }
      throw new AuthError('Registration failed', error.code, error);
    }
  }

  async login(request: LoginRequest): Promise<AuthResponse> {
    try {
      const userCredential = await signInWithEmailAndPassword(
        this.auth,
        request.email,
        request.password
      );
      return this.getAuthResponse(userCredential.user);
    } catch (error: any) {
      if (error.code === 'auth/wrong-password' || error.code === 'auth/user-not-found') {
        throw new InvalidCredentialsError();
      }
      throw new AuthError('Login failed', error.code, error);
    }
  }

  async loginWithGoogle(): Promise<AuthResponse> {
    try {
      const result = await signInWithPopup(this.auth, this.googleProvider);
      return this.getAuthResponse(result.user);
    } catch (error: any) {
      throw new AuthError('Google login failed', error.code, error);
    }
  }

  async loginWithFacebook(): Promise<AuthResponse> {
    try {
      const result = await signInWithPopup(this.auth, this.facebookProvider);
      return this.getAuthResponse(result.user);
    } catch (error: any) {
      throw new AuthError('Facebook login failed', error.code, error);
    }
  }

  async refreshToken(refreshToken: string): Promise<{ token: string; refreshToken: string }> {
    // Firebase handles token refresh automatically
    const currentUser = this.auth.currentUser;
    if (!currentUser) {
      throw new AuthError('No user logged in', 'auth/no-current-user');
    }

    const token = await currentUser.getIdToken(true);
    return {
      token,
      refreshToken: currentUser.refreshToken
    };
  }

  async logout(): Promise<void> {
    await signOut(this.auth);
  }

  async getCurrentUser(): Promise<User | null> {
    const currentUser = this.auth.currentUser;
    if (!currentUser) return null;
    return this.firebaseUserToUser(currentUser);
  }

  async updateUserProfile(userId: string, updates: Partial<User>): Promise<User> {
    const currentUser = this.auth.currentUser;
    if (!currentUser || currentUser.uid !== userId) {
      throw new AuthError('Unauthorized profile update', 'auth/unauthorized');
    }

    await updateProfile(currentUser, {
      displayName: updates.displayName || null,
      photoURL: updates.photoURL || null
    });

    return this.firebaseUserToUser(currentUser);
  }

  async updateUserRoles(userId: string, roles: string[]): Promise<User> {
    // This would typically involve updating custom claims in Firebase Auth
    // and would require Firebase Admin SDK on the backend
    throw new Error('Method not implemented - requires backend implementation');
  }

  async sendEmailVerification(): Promise<void> {
    const currentUser = this.auth.currentUser;
    if (!currentUser) {
      throw new AuthError('No user logged in', 'auth/no-current-user');
    }
    await fbSendEmailVerification(currentUser);
  }

  async verifyEmail(oobCode: string): Promise<void> {
    // Firebase handles email verification through links
    // This method would be called on the verification page
    throw new Error('Method not implemented - requires backend implementation');
  }

  async sendPasswordResetEmail(email: string): Promise<void> {
    await fbSendPasswordResetEmail(this.auth, email);
  }

  async confirmPasswordReset(oobCode: string, newPassword: string): Promise<void> {
    await verifyPasswordResetCode(this.auth, oobCode);
    await fbConfirmPasswordReset(this.auth, oobCode, newPassword);
  }
} 