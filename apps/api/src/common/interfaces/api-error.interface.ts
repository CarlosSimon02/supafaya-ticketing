export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: Record<string, any>;
  };
} 