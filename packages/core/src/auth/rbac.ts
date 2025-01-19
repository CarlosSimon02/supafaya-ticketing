import { UserRole } from './types';

export class RBACError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RBACError';
  }
}

interface AuthenticatedUser {
  id: string;
  roles: UserRole[];
  [key: string]: any;
}

export interface RequestWithUser {
  user?: AuthenticatedUser | undefined;
}

export interface AuthenticatedRequest extends RequestWithUser {
  user: {
    id: string;
    roles: UserRole[];
    [key: string]: any;
  };
}

function isAuthenticated(req: RequestWithUser): req is AuthenticatedRequest {
  return !!req.user?.id && Array.isArray(req.user?.roles);
}

/**
 * Check if user has any of the required roles
 */
export function hasRole(userRoles: UserRole[], requiredRoles: UserRole[]): boolean {
  return userRoles.some(role => requiredRoles.includes(role));
}

/**
 * Check if user has all of the required roles
 */
export function hasAllRoles(userRoles: UserRole[], requiredRoles: UserRole[]): boolean {
  return requiredRoles.every(role => userRoles.includes(role));
}

/**
 * Middleware factory for role-based access control
 * @param roles - Array of roles that are allowed to access the route
 * @param requireAll - If true, user must have all roles. If false, user must have at least one role.
 */
export function requireRoles(roles: UserRole[], requireAll: boolean = false) {
  return (req: RequestWithUser, res: any, next: (error?: any) => void) => {
    if (!isAuthenticated(req)) {
      return next(new RBACError('User not authenticated'));
    }

    const hasRequiredRoles = requireAll
      ? hasAllRoles(req.user.roles, roles)
      : hasRole(req.user.roles, roles);

    if (!hasRequiredRoles) {
      return next(
        new RBACError(
          `Access denied. Required roles: ${roles.join(', ')}. User roles: ${req.user.roles.join(', ')}`
        )
      );
    }

    next();
  };
}

/**
 * Middleware to require specific role combinations
 * @param roleCombinations - Array of role combinations, where each combination is an array of roles
 */
export function requireRoleCombinations(roleCombinations: UserRole[][]) {
  return (req: RequestWithUser, res: any, next: (error?: any) => void) => {
    if (!isAuthenticated(req)) {
      return next(new RBACError('User not authenticated'));
    }

    const hasValidCombination = roleCombinations.some(combination =>
      hasAllRoles(req.user.roles, combination)
    );

    if (!hasValidCombination) {
      return next(
        new RBACError(
          `Access denied. Required one of role combinations: ${roleCombinations
            .map(combo => `[${combo.join(' AND ')}]`)
            .join(' OR ')}`
        )
      );
    }

    next();
  };
}

/**
 * Middleware to check if user is accessing their own resource
 * @param getUserId - Function to extract the user ID from the request parameters
 */
export function requireSelfOrRoles(getUserId: (req: any) => string, roles: UserRole[]) {
  return (req: RequestWithUser, res: any, next: (error?: any) => void) => {
    if (!isAuthenticated(req)) {
      return next(new RBACError('User not authenticated'));
    }

    const resourceUserId = getUserId(req);
    const isSelf = req.user.id === resourceUserId;
    const hasRequiredRoles = hasRole(req.user.roles, roles);

    if (!isSelf && !hasRequiredRoles) {
      return next(
        new RBACError(
          `Access denied. Must be resource owner or have one of roles: ${roles.join(', ')}`
        )
      );
    }

    next();
  };
} 