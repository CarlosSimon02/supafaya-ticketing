import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { Response } from 'express';
import { ApiError } from '../interfaces/api-error.interface';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let error: ApiError = {
      error: {
        code: 'internal_server_error',
        message: 'Internal server error',
      },
    };

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      // If the exception already follows our error format, use it
      if (this.isApiError(exceptionResponse)) {
        error = exceptionResponse as ApiError;
      } else if (typeof exceptionResponse === 'object') {
        // Convert other exception responses to our format
        error = {
          error: {
            code: this.getErrorCode(status),
            message: exception.message,
            details: exceptionResponse,
          },
        };
      } else {
        error = {
          error: {
            code: this.getErrorCode(status),
            message: exception.message,
          },
        };
      }
    } else if (exception instanceof Error) {
      // Handle other errors
      error = {
        error: {
          code: 'internal_server_error',
          message: 'An unexpected error occurred',
          details: {
            name: exception.name,
            message: exception.message,
          },
        },
      };
    }

    response.status(status).json(error);
  }

  private isApiError(obj: any): boolean {
    return obj && obj.error && 
           typeof obj.error.code === 'string' && 
           typeof obj.error.message === 'string';
  }

  private getErrorCode(status: number): string {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return 'bad_request';
      case HttpStatus.UNAUTHORIZED:
        return 'unauthorized';
      case HttpStatus.FORBIDDEN:
        return 'forbidden';
      case HttpStatus.NOT_FOUND:
        return 'not_found';
      case HttpStatus.TOO_MANY_REQUESTS:
        return 'rate_limit_exceeded';
      default:
        return 'internal_server_error';
    }
  }
} 