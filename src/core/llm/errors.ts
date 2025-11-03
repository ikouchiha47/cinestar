/**
 * LLM Provider Error Classes
 */

export class ProviderError extends Error {
  constructor(
    message: string,
    public provider: string,
    public statusCode?: number,
    public retryable: boolean = false
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export class AuthenticationError extends ProviderError {
  constructor(provider: string, message?: string) {
    super(
      message || `Authentication failed for ${provider}. Please check your API key.`,
      provider,
      401,
      false
    );
    this.name = 'AuthenticationError';
  }
}

export class RateLimitError extends ProviderError {
  constructor(provider: string, public retryAfter?: number, message?: string) {
    super(
      message || `Rate limit exceeded for ${provider}. Please try again later.`,
      provider,
      429,
      true
    );
    this.name = 'RateLimitError';
  }
}

export class ModelNotFoundError extends ProviderError {
  constructor(provider: string, model: string, message?: string) {
    super(
      message || `Model ${model} not found for ${provider}. Please check the model name.`,
      provider,
      404,
      false
    );
    this.name = 'ModelNotFoundError';
  }
}

export class BadRequestError extends ProviderError {
  constructor(provider: string, message: string) {
    super(message, provider, 400, false);
    this.name = 'BadRequestError';
  }
}

export class ServiceError extends ProviderError {
  constructor(provider: string, message: string, statusCode: number = 500) {
    super(message, provider, statusCode, true);
    this.name = 'ServiceError';
  }
}

/**
 * Check if an error is retryable
 */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof ProviderError) {
    return error.retryable;
  }
  return false;
}

/**
 * Get user-friendly error message
 */
export function getUserFriendlyMessage(error: unknown): string {
  if (error instanceof AuthenticationError) {
    return 'Authentication failed. Please check your API key in settings.';
  }
  
  if (error instanceof RateLimitError) {
    const retryMsg = error.retryAfter 
      ? ` Please try again in ${error.retryAfter} seconds.`
      : ' Please try again later.';
    return `Rate limit exceeded.${retryMsg}`;
  }
  
  if (error instanceof ModelNotFoundError) {
    return 'The selected model is not available. Please choose a different model.';
  }
  
  if (error instanceof BadRequestError) {
    return `Invalid request: ${error.message}`;
  }
  
  if (error instanceof ServiceError) {
    return 'The AI service is temporarily unavailable. Please try again.';
  }
  
  if (error instanceof ProviderError) {
    return error.message;
  }
  
  if (error instanceof Error) {
    return error.message;
  }
  
  return 'An unknown error occurred.';
}
