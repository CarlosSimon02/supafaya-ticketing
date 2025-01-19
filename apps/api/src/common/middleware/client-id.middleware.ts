import { Injectable, NestMiddleware, UnauthorizedException, HttpException, HttpStatus } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { Redis } from 'ioredis';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class ClientIdMiddleware implements NestMiddleware {
  constructor(
    private readonly redis: Redis,
    private readonly configService: ConfigService,
  ) {}

  async use(req: Request, res: Response, next: NextFunction) {
    const clientId = req.header('X-Client-ID');

    if (!clientId) {
      throw new UnauthorizedException({
        error: {
          code: 'missing_client_id',
          message: 'Client ID is required',
        },
      });
    }

    // Validate Client ID format
    if (!this.isValidClientId(clientId)) {
      throw new UnauthorizedException({
        error: {
          code: 'invalid_client_id',
          message: 'Invalid Client ID format',
        },
      });
    }

    // Check rate limits
    const isUserRoute = req.path.startsWith('/api/v1/user');
    const limit = isUserRoute ? 100 : 1000; // User routes: 100/hour, Public routes: 1000/hour
    const window = 3600; // 1 hour in seconds

    const rateLimitKey = `ratelimit:${clientId}:${isUserRoute ? 'user' : 'public'}`;
    const current = await this.redis.incr(rateLimitKey);
    
    if (current === 1) {
      await this.redis.expire(rateLimitKey, window);
    }

    if (current > limit) {
      throw new HttpException({
        error: {
          code: 'rate_limit_exceeded',
          message: 'Rate limit exceeded',
          details: {
            limit,
            window: '1 hour',
            type: isUserRoute ? 'user' : 'public',
          },
        },
      }, HttpStatus.TOO_MANY_REQUESTS);
    }

    // Add remaining rate limit info to response headers
    res.header('X-RateLimit-Limit', limit.toString());
    res.header('X-RateLimit-Remaining', Math.max(0, limit - current).toString());
    
    const ttl = await this.redis.ttl(rateLimitKey);
    res.header('X-RateLimit-Reset', (Date.now() + (ttl * 1000)).toString());

    next();
  }

  private isValidClientId(clientId: string): boolean {
    return /^supafaya_tx_[a-zA-Z0-9]{32}$/.test(clientId);
  }
} 