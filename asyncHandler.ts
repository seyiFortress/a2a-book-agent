// asyncHandler.ts
// Comprehensive async error handling utilities for the A2A Book Agent

import { Request, Response, NextFunction } from 'express';
import { 
  EnhancedRequest, 
  EnhancedResponse, 
  ApiResponse,
  ValidationError,
  ExternalAPIError,
  EnvironmentError
} from './types.js';
import { handleError } from './validation.js';

/**
 * Wrapper for async route handlers to catch and handle errors properly
 */
export function asyncHandler(
  fn: (req: EnhancedRequest, res: EnhancedResponse, next: NextFunction) => Promise<void>
) {
  return (req: EnhancedRequest, res: EnhancedResponse, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * Wrapper for async middleware to catch and handle errors properly
 */
export function asyncMiddleware(
  fn: (req: EnhancedRequest, res: EnhancedResponse, next: NextFunction) => Promise<void>
) {
  return (req: EnhancedRequest, res: EnhancedResponse, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * Timeout wrapper for async operations
 */
export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string = 'Operation timed out'
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
    })
  ]);
}

/**
 * Retry wrapper for async operations with exponential backoff
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  baseDelayMs: number = 1000,
  maxDelayMs: number = 10000
): Promise<T> {
  let lastError: Error;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      if (attempt === maxRetries) {
        break;
      }
      
      // Calculate delay with exponential backoff
      const delay = Math.min(baseDelayMs * Math.pow(2, attempt - 1), maxDelayMs);
      console.log(`⚠️ Attempt ${attempt} failed, retrying in ${delay}ms...`);
      
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError!;
}

/**
 * Circuit breaker pattern for async operations
 */
export class CircuitBreaker {
  private failures = 0;
  private lastFailureTime = 0;
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
  
  constructor(
    private readonly threshold: number = 5,
    private readonly timeout: number = 60000,
    private readonly resetTimeout: number = 30000
  ) {}
  
  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime > this.resetTimeout) {
        this.state = 'HALF_OPEN';
        console.log('🔄 Circuit breaker moving to HALF_OPEN state');
      } else {
        throw new Error('Circuit breaker is OPEN');
      }
    }
    
    try {
      const result = await withTimeout(operation(), this.timeout);
      
      if (this.state === 'HALF_OPEN') {
        this.reset();
        console.log('✅ Circuit breaker reset to CLOSED state');
      }
      
      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }
  
  private recordFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();
    
    if (this.failures >= this.threshold) {
      this.state = 'OPEN';
      console.log(`🚫 Circuit breaker opened after ${this.failures} failures`);
    }
  }
  
  private reset(): void {
    this.failures = 0;
    this.state = 'CLOSED';
  }
  
  getState(): string {
    return this.state;
  }
}

/**
 * Bulk operation handler with partial success handling
 */
export async function handleBulkOperation<T, R>(
  items: T[],
  operation: (item: T) => Promise<R>,
  options: {
    continueOnError?: boolean;
    maxConcurrency?: number;
  } = {}
): Promise<{
  results: R[];
  errors: { item: T; error: Error }[];
  successCount: number;
  errorCount: number;
}> {
  const { continueOnError = true, maxConcurrency = 5 } = options;
  const results: R[] = [];
  const errors: { item: T; error: Error }[] = [];
  
  // Process items in batches to control concurrency
  const batches = [];
  for (let i = 0; i < items.length; i += maxConcurrency) {
    batches.push(items.slice(i, i + maxConcurrency));
  }
  
  for (const batch of batches) {
    const batchPromises = batch.map(async (item) => {
      try {
        const result = await operation(item);
        return { success: true, result, item };
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        return { success: false, error: err, item };
      }
    });
    
    const batchResults = await Promise.all(batchPromises);
    
    for (const result of batchResults) {
      if (result.success && result.result !== undefined) {
        results.push(result.result);
      } else if (!result.success && result.error) {
        errors.push({ item: result.item, error: result.error });
        
        if (!continueOnError) {
          throw result.error;
        }
      }
    }
  }
  
  return {
    results,
    errors,
    successCount: results.length,
    errorCount: errors.length
  };
}

/**
 * Async queue for processing tasks with rate limiting
 */
export class AsyncQueue<T> {
  private queue: T[] = [];
  private processing = false;
  private readonly concurrency: number;
  private readonly processor: (item: T) => Promise<void>;
  private readonly delayMs: number;
  
  constructor(
    processor: (item: T) => Promise<void>,
    concurrency: number = 1,
    delayMs: number = 0
  ) {
    this.processor = processor;
    this.concurrency = concurrency;
    this.delayMs = delayMs;
  }
  
  async add(item: T): Promise<void> {
    this.queue.push(item);
    await this.process();
  }
  
  async addBatch(items: T[]): Promise<void> {
    this.queue.push(...items);
    await this.process();
  }
  
  private async process(): Promise<void> {
    if (this.processing || this.queue.length === 0) {
      return;
    }
    
    this.processing = true;
    
    const batch = this.queue.splice(0, this.concurrency);
    const promises = batch.map(item => this.processor(item));
    
    try {
      await Promise.all(promises);
    } catch (error) {
      console.error('Error processing batch:', error);
    }
    
    if (this.delayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, this.delayMs));
    }
    
    this.processing = false;
    
    // Process next batch if there are more items
    if (this.queue.length > 0) {
      await this.process();
    }
  }
  
  size(): number {
    return this.queue.length;
  }
  
  clear(): void {
    this.queue = [];
  }
}

/**
 * Cache decorator for async functions
 */
export function withCache<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  cache: Map<string, any>,
  ttlMs: number = 300000, // 5 minutes default
  keyGenerator?: (...args: Parameters<T>) => string
): T {
  return (async (...args: Parameters<T>) => {
    const key = keyGenerator ? keyGenerator(...args) : JSON.stringify(args);
    const cached = cache.get(key);
    
    if (cached && Date.now() - cached.timestamp < ttlMs) {
      return cached.value;
    }
    
    const result = await fn(...args);
    cache.set(key, {
      value: result,
      timestamp: Date.now()
    });
    
    return result;
  }) as T;
}

/**
 * Memory cache implementation
 */
export class MemoryCache {
  private cache = new Map<string, { value: any; timestamp: number }>();
  
  get<T>(key: string): T | undefined {
    const item = this.cache.get(key);
    if (!item) {
      return undefined;
    }
    
    return item.value;
  }
  
  set(key: string, value: any, ttlMs: number = 300000): void {
    this.cache.set(key, {
      value,
      timestamp: Date.now()
    });
    
    // Auto-expire
    setTimeout(() => {
      this.cache.delete(key);
    }, ttlMs);
  }
  
  delete(key: string): boolean {
    return this.cache.delete(key);
  }
  
  clear(): void {
    this.cache.clear();
  }
  
  size(): number {
    return this.cache.size;
  }
  
  cleanup(): void {
    const now = Date.now();
    for (const [key, item] of this.cache.entries()) {
      if (now - item.timestamp > 300000) { // 5 minutes
        this.cache.delete(key);
      }
    }
  }
}

/**
 * Health check for async operations
 */
export class HealthChecker {
  private checks = new Map<string, () => Promise<boolean>>();
  
  addCheck(name: string, check: () => Promise<boolean>): void {
    this.checks.set(name, check);
  }
  
  async runChecks(): Promise<{
    healthy: boolean;
    checks: { name: string; healthy: boolean; error?: string }[];
  }> {
    const results = [];
    let allHealthy = true;
    
    for (const [name, check] of this.checks.entries()) {
      try {
        const healthy = await withTimeout(check(), 5000, 'Health check timeout');
        results.push({ name, healthy });
        if (!healthy) {
          allHealthy = false;
        }
      } catch (error) {
        results.push({ 
          name, 
          healthy: false, 
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        allHealthy = false;
      }
    }
    
    return {
      healthy: allHealthy,
      checks: results
    };
  }
}

/**
 * Async operation metrics collector
 */
export class AsyncMetrics {
  private metrics = new Map<string, {
    count: number;
    totalTime: number;
    errors: number;
    lastError?: string;
  }>();
  
  async measure<T>(
    operation: string,
    fn: () => Promise<T>
  ): Promise<T> {
    const startTime = Date.now();
    
    try {
      const result = await fn();
      this.recordSuccess(operation, Date.now() - startTime);
      return result;
    } catch (error) {
      this.recordError(operation, error instanceof Error ? error.message : 'Unknown error');
      throw error;
    }
  }
  
  private recordSuccess(operation: string, duration: number): void {
    const current = this.metrics.get(operation) || {
      count: 0,
      totalTime: 0,
      errors: 0
    };
    
    current.count++;
    current.totalTime += duration;
    
    this.metrics.set(operation, current);
  }
  
  private recordError(operation: string, error: string): void {
    const current = this.metrics.get(operation) || {
      count: 0,
      totalTime: 0,
      errors: 0
    };
    
    current.count++;
    current.errors++;
    current.lastError = error;
    
    this.metrics.set(operation, current);
  }
  
  getMetrics(): Record<string, {
    count: number;
    averageTime: number;
    errorRate: number;
    lastError?: string;
  }> {
    const result: Record<string, any> = {};
    
    for (const [operation, metrics] of this.metrics.entries()) {
      result[operation] = {
        count: metrics.count,
        averageTime: metrics.totalTime / metrics.count,
        errorRate: metrics.errors / metrics.count,
        lastError: metrics.lastError
      };
    }
    
    return result;
  }
  
  reset(): void {
    this.metrics.clear();
  }
}