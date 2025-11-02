// validation.ts
// Centralized validation and error handling utilities

import { z } from 'zod';
import { Request, Response, NextFunction } from 'express';
import {
  ApiResponse,
  EnhancedRequest,
  EnhancedResponse,
  RateLimitConfig,
  SecurityContext,
  ValidationError as ValidationErrorType,
  EnvironmentError as EnvironmentErrorType,
  ExternalAPIError as ExternalAPIErrorType
} from './types.js';

// Re-export error classes for backward compatibility
export { ValidationErrorType as ValidationError };
export { EnvironmentErrorType as EnvironmentError };
export { ExternalAPIErrorType as ExternalAPIError };

// Input sanitization utilities
export class InputSanitizer {
  /**
   * Sanitizes a string input by removing potentially harmful characters
   */
  static sanitizeString(input: unknown): string {
    if (typeof input !== 'string') {
      throw new ValidationErrorType('Input must be a string');
    }
    
    // Remove null bytes and control characters except newlines and tabs
    return input
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
      .trim();
  }

  /**
   * Sanitizes a search query for book searches
   */
  static sanitizeSearchQuery(query: unknown): string {
    const sanitized = this.sanitizeString(query);
    
    // Additional validation for search queries
    if (sanitized.length < 1) {
      throw new ValidationErrorType('Search query cannot be empty');
    }
    
    if (sanitized.length > 200) {
      throw new ValidationErrorType('Search query is too long (max 200 characters)');
    }
    
    // Check for potential injection patterns
    const dangerousPatterns = [
      /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
      /javascript:/gi,
      /on\w+\s*=/gi,
    ];
    
    for (const pattern of dangerousPatterns) {
      if (pattern.test(sanitized)) {
        throw new ValidationErrorType('Search query contains potentially dangerous content');
      }
    }
    
    return sanitized;
  }

  /**
   * Validates and sanitizes a task ID
   */
  static validateTaskId(taskId: unknown): string {
    const sanitized = this.sanitizeString(taskId);
    
    if (!sanitized) {
      throw new ValidationErrorType('Task ID is required');
    }
    
    // Task IDs should be alphanumeric with underscores and hyphens
    if (!/^[a-zA-Z0-9_-]+$/.test(sanitized)) {
      throw new ValidationErrorType('Invalid task ID format');
    }
    
    return sanitized;
  }

  /**
   * Validates URL format
   */
  static validateUrl(url: unknown): string {
    const sanitized = this.sanitizeString(url);
    
    try {
      new URL(sanitized);
      return sanitized;
    } catch {
      throw new ValidationErrorType('Invalid URL format');
    }
  }

  /**
   * Sanitizes and validates email format
   */
  static validateEmail(email: unknown): string {
    const sanitized = this.sanitizeString(email);
    
    if (!sanitized) {
      throw new ValidationErrorType('Email is required');
    }
    
    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(sanitized)) {
      throw new ValidationErrorType('Invalid email format');
    }
    
    return sanitized.toLowerCase();
  }

  /**
   * Validates and sanitizes numeric input
   */
  static validateNumber(input: unknown, min?: number, max?: number): number {
    const num = Number(input);
    
    if (isNaN(num)) {
      throw new ValidationErrorType('Input must be a valid number');
    }
    
    if (min !== undefined && num < min) {
      throw new ValidationErrorType(`Number must be at least ${min}`);
    }
    
    if (max !== undefined && num > max) {
      throw new ValidationErrorType(`Number must be at most ${max}`);
    }
    
    return num;
  }

  /**
   * Validates and sanitizes boolean input
   */
  static validateBoolean(input: unknown): boolean {
    if (typeof input === 'boolean') {
      return input;
    }
    
    if (typeof input === 'string') {
      const lower = input.toLowerCase().trim();
      if (lower === 'true') return true;
      if (lower === 'false') return false;
    }
    
    if (typeof input === 'number') {
      return input !== 0;
    }
    
    throw new ValidationErrorType('Input must be a boolean value');
  }
}

// Zod schemas for validation
export const schemas = {
  // Book extraction request schema
  bookExtractionRequest: z.object({
    searchQuery: z.string()
      .min(1, 'Search query is required')
      .max(200, 'Search query is too long (max 200 characters)')
      .transform(val => InputSanitizer.sanitizeSearchQuery(val))
  }),

  // Telex message schema
  telexMessage: z.object({
    role: z.enum(['user', 'assistant']),
    parts: z.array(z.object({
      type: z.enum(['text', 'file', 'data']),
      text: z.string().optional(),
      file: z.any().optional(),
      data: z.any().optional(),
    })).min(1, 'Message must have at least one part')
  }),

  // Telex request schema
  telexRequest: z.object({
    method: z.string().min(1, 'Method is required'),
    params: z.any().optional(),
    id: z.union([z.string(), z.number()]).optional()
  }),

  // Task ID schema
  taskId: z.string()
    .min(1, 'Task ID is required')
    .transform(val => InputSanitizer.validateTaskId(val)),

  // Push notification config schema
  pushNotificationConfig: z.object({
    url: z.string().url('Invalid URL format').optional(),
    authentication: z.object({
      type: z.enum(['bearer', 'basic']),
      token: z.string().optional(),
      username: z.string().optional(),
      password: z.string().optional(),
    }).optional()
  }).optional()
};

// Environment variable validation
export class EnvironmentValidator {
  private static requiredVars = [
    'NODE_ENV',
  ];

  private static optionalVars = [
    'PORT',
    'HOST',
    'OPENAI_API_KEY',
  ];

  /**
   * Validates all required environment variables
   */
  static validate(): void {
    const missing: string[] = [];
    
    for (const varName of this.requiredVars) {
      if (!process.env[varName]) {
        missing.push(varName);
      }
    }
    
    if (missing.length > 0) {
      throw new EnvironmentErrorType(
        `Missing required environment variables: ${missing.join(', ')}`
      );
    }
    
    // Validate PORT if provided
    if (process.env.PORT) {
      const port = parseInt(process.env.PORT, 10);
      if (isNaN(port) || port < 1 || port > 65535) {
        throw new EnvironmentErrorType('PORT must be a valid port number (1-65535)');
      }
    }
    
    // Validate HOST if provided
    if (process.env.HOST) {
      const host = process.env.HOST.trim();
      if (!host) {
        throw new EnvironmentErrorType('HOST cannot be empty');
      }
    }
    
    // Validate NODE_ENV
    const validEnvs = ['development', 'production', 'test'];
    if (process.env.NODE_ENV && !validEnvs.includes(process.env.NODE_ENV)) {
      throw new EnvironmentErrorType(
        `NODE_ENV must be one of: ${validEnvs.join(', ')}`
      );
    }
  }

  /**
   * Gets a validated environment variable
   */
  static get(key: string): string {
    const value = process.env[key];
    if (!value) {
      throw new EnvironmentErrorType(`Environment variable ${key} is not set`);
    }
    return value;
  }

  /**
   * Gets an optional environment variable with default
   */
  static getOptional(key: string, defaultValue: string = ''): string {
    return process.env[key] || defaultValue;
  }
}

// Rate limiting utilities
export class RateLimiter {
  private static requests = new Map<string, { count: number; resetTime: number }>();
  
  /**
   * Simple in-memory rate limiter
   */
  static checkLimit(
    identifier: string, 
    maxRequests: number = 100, 
    windowMs: number = 60000
  ): { allowed: boolean; resetTime?: number } {
    const now = Date.now();
    const key = identifier;
    const current = this.requests.get(key);
    
    if (!current || now > current.resetTime) {
      // New window or expired window
      this.requests.set(key, {
        count: 1,
        resetTime: now + windowMs
      });
      return { allowed: true };
    }
    
    if (current.count >= maxRequests) {
      return { 
        allowed: false, 
        resetTime: current.resetTime 
      };
    }
    
    current.count++;
    return { allowed: true };
  }
}

// Express middleware for validation
export function validateRequest(schema: z.ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        const validationError = new ValidationErrorType(
          'Invalid request data',
          400,
          'VALIDATION_ERROR',
          error.issues
        );
        return handleError(validationError, req, res);
      }
      next(error);
    }
  };
}

// Express middleware for rate limiting
export function rateLimit(maxRequests: number = 100, windowMs: number = 60000) {
  return (req: Request, res: Response, next: NextFunction) => {
    const identifier = req.ip || 'unknown';
    const result = RateLimiter.checkLimit(identifier, maxRequests, windowMs);
    
    if (!result.allowed) {
      const error = new ValidationErrorType(
        'Too many requests',
        429,
        'RATE_LIMIT_EXCEEDED',
        { resetTime: result.resetTime }
      );
      return handleError(error, req, res);
    }
    
    next();
  };
}

// Centralized error handler for Express
export function handleError(error: Error, req: Request, res: Response): void {
  console.error(`❌ Error [${req.method} ${req.path}]:`, error);
  
  // Default error response
  let statusCode = 500;
  let errorCode = 'INTERNAL_ERROR';
  let message = 'Internal server error';
  let details: any = undefined;
  
  // Handle specific error types
  if (error instanceof ValidationErrorType) {
    statusCode = error.statusCode;
    errorCode = error.code;
    message = error.message;
    details = error.details;
  } else if (error instanceof EnvironmentErrorType) {
    statusCode = error.statusCode;
    errorCode = error.code;
    message = error.message;
  } else if (error instanceof ExternalAPIErrorType) {
    statusCode = error.statusCode;
    errorCode = error.code;
    message = error.message;
    details = { service: error.service };
  } else if (error instanceof z.ZodError) {
    statusCode = 400;
    errorCode = 'VALIDATION_ERROR';
    message = 'Invalid request data';
    details = error.issues;
  }
  
  // Build error response
  const errorResponse: any = {
    error: {
      code: errorCode,
      message,
      timestamp: new Date().toISOString(),
      path: req.path,
      method: req.method,
    }
  };
  
  // Add details if available
  if (details) {
    errorResponse.error.details = details;
  }
  
  // Add stack trace in development
  if (process.env.NODE_ENV === 'development') {
    errorResponse.error.stack = error.stack;
  }
  
  res.status(statusCode).json(errorResponse);
}

// A2A Protocol specific error handling
export class A2AErrorHandler {
  /**
   * Creates a standardized A2A error response
   */
  static createErrorResponse(
    code: number,
    message: string,
    id?: string | number | null,
    data?: any
  ): any {
    return {
      jsonrpc: '2.0',
      error: {
        code,
        message,
        ...(data && { data })
      },
      id: id || null
    };
  }
  
  /**
   * Handles validation errors for A2A requests
   */
  static handleValidationError(error: ValidationErrorType, id?: string | number | null): any {
    return this.createErrorResponse(
      -32602, // Invalid params
      error.message,
      id,
      error.details
    );
  }
  
  /**
   * Handles internal errors for A2A requests
   */
  static handleInternalError(error: Error, id?: string | number | null): any {
    return this.createErrorResponse(
      -32603, // Internal error
      process.env.NODE_ENV === 'production' 
        ? 'Internal error' 
        : error.message,
      id,
      process.env.NODE_ENV === 'development' ? error.stack : undefined
    );
  }
  
  /**
   * Handles method not found errors for A2A requests
   */
  static handleMethodNotFound(method: string, id?: string | number | null): any {
    return this.createErrorResponse(
      -32601, // Method not found
      `Method not found: ${method}`,
      id,
      {
        availableMethods: [
          'message/send',
          'message/stream',
          'tasks/get',
          'tasks/cancel',
          'tasks/setPushNotificationConfig',
          'tasks/getPushNotificationConfig',
          'tasks/resubscribe'
        ]
      }
    );
  }
  
  /**
   * Handles task not found errors for A2A requests
   */
  static handleTaskNotFound(taskId: string, id?: string | number | null): any {
    return this.createErrorResponse(
      -32001, // Custom error code for task not found
      `Task not found: ${taskId}`,
      id
    );
  }
}