import { Auth as AdminAuth } from 'firebase-admin/auth';
import { 
  AuthError, 
  User, 
  UserRole,
  userSchema 
} from './types';

export class FirebaseAdminAuthService {
  constructor(private adminAuth: AdminAuth) {}

  private async adminUserToUser(adminUser: any): Promise<User> {
    const userData = {
      id: adminUser.uid,
      email: adminUser.email,
      displayName: adminUser.displayName || undefined,
      photoURL: adminUser.photoURL || undefined,
      emailVerified: adminUser.emailVerified,
      phoneNumber: adminUser.phoneNumber || undefined,
      providerData: adminUser.providerData,
      roles: adminUser.customClaims?.roles || [UserRole.USER],
      createdAt: new Date(adminUser.metadata.creationTime),
      updatedAt: new Date(adminUser.metadata.lastSignInTime),
    };

    return userSchema.parse(userData);
  }

  async getUserById(userId: string): Promise<User> {
    try {
      const adminUser = await this.adminAuth.getUser(userId);
      return this.adminUserToUser(adminUser);
    } catch (error: any) {
      throw new AuthError(
        'Failed to get user',
        error.code || 'auth/user-not-found',
        error
      );
    }
  }

  async updateUserRoles(userId: string, roles: UserRole[]): Promise<User> {
    try {
      // Get existing custom claims
      const { customClaims } = await this.adminAuth.getUser(userId);
      
      // Update roles in custom claims
      await this.adminAuth.setCustomUserClaims(userId, {
        ...customClaims,
        roles
      });

      // Get updated user
      return this.getUserById(userId);
    } catch (error: any) {
      throw new AuthError(
        'Failed to update user roles',
        error.code || 'auth/update-roles-failed',
        error
      );
    }
  }

  async verifyEmail(userId: string): Promise<User> {
    try {
      await this.adminAuth.updateUser(userId, {
        emailVerified: true
      });

      return this.getUserById(userId);
    } catch (error: any) {
      throw new AuthError(
        'Failed to verify email',
        error.code || 'auth/verify-email-failed',
        error
      );
    }
  }

  async listUsers(maxResults: number = 1000): Promise<User[]> {
    try {
      const listUsersResult = await this.adminAuth.listUsers(maxResults);
      return Promise.all(
        listUsersResult.users.map(user => this.adminUserToUser(user))
      );
    } catch (error: any) {
      throw new AuthError(
        'Failed to list users',
        error.code || 'auth/list-users-failed',
        error
      );
    }
  }

  async deleteUser(userId: string): Promise<void> {
    try {
      await this.adminAuth.deleteUser(userId);
    } catch (error: any) {
      throw new AuthError(
        'Failed to delete user',
        error.code || 'auth/delete-user-failed',
        error
      );
    }
  }

  async disableUser(userId: string): Promise<User> {
    try {
      await this.adminAuth.updateUser(userId, { disabled: true });
      return this.getUserById(userId);
    } catch (error: any) {
      throw new AuthError(
        'Failed to disable user',
        error.code || 'auth/disable-user-failed',
        error
      );
    }
  }

  async enableUser(userId: string): Promise<User> {
    try {
      await this.adminAuth.updateUser(userId, { disabled: false });
      return this.getUserById(userId);
    } catch (error: any) {
      throw new AuthError(
        'Failed to enable user',
        error.code || 'auth/enable-user-failed',
        error
      );
    }
  }
} 