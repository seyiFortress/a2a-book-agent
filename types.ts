// types.ts
// Comprehensive TypeScript type definitions for the A2A Book Agent

// ====== Core Types ======

/**
 * Base API response structure
 */
export interface ApiResponse<T = any> {
  success?: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
  timestamp: string;
}

/**
 * Pagination information
 */
export interface PaginationInfo {
  page: number;
  limit: number;
  total: number;
  hasNext: boolean;
  hasPrev: boolean;
}

/**
 * Health check response
 */
export interface HealthCheckResponse {
  status: 'healthy' | 'unhealthy';
  timestamp: string;
  service: string;
  version: string;
  environment: string;
  uptime: number;
  memory: NodeJS.MemoryUsage;
  dependencies: {
    [key: string]: string;
  };
}

// ====== Book Related Types ======

/**
 * Book author information
 */
export interface BookAuthor {
  name: string;
  birth_year?: number;
  death_year?: number;
}

/**
 * Book format information
 */
export interface BookFormats {
  [key: string]: string | undefined;
  'text/plain; charset=us-ascii'?: string;
  'text/plain'?: string;
  'text/plain; charset=utf-8'?: string;
  'text/html'?: string;
  'application/epub+zip'?: string;
  'application/x-mobipocket-ebook'?: string;
  'application/pdf'?: string;
}

/**
 * Book information from Gutenberg API
 */
export interface GutenbergBook {
  id: number;
  title: string;
  authors: BookAuthor[];
  formats: BookFormats;
  download_count: number;
  languages: string[];
  subjects: string[];
  copyright: boolean;
  media_type: string;
}

/**
 * Book search response from Gutenberg API
 */
export interface GutenbergSearchResponse {
  count: number;
  next?: string;
  previous?: string;
  results: GutenbergBook[];
}

/**
 * Book extraction result
 */
export interface BookExtractionResult {
  title: string;
  authors: string;
  excerpt: string;
  source: string;
  downloadCount?: number;
  languages?: string[];
  subjects?: string[];
}

/**
 * Book extraction error result
 */
export interface BookExtractionError {
  error: string;
  code?: string;
  details?: any;
  suggestions?: string[];
}

// ====== A2A Protocol Types ======

/**
 * A2A message part
 */
export interface A2AMessagePart {
  type: 'text' | 'file' | 'data';
  text?: string;
  file?: any;
  data?: any;
}

/**
 * A2A message
 */
export interface A2AMessage {
  role: 'user' | 'assistant';
  parts: A2AMessagePart[];
}

/**
 * A2A task status
 */
export interface A2ATaskStatus {
  state: 'working' | 'completed' | 'canceled';
  timestamp: string;
  message?: A2AMessage;
}

/**
 * A2A artifact
 */
export interface A2AArtifact {
  type: string;
  data: any;
  timestamp: string;
  name?: string;
}

/**
 * A2A task history event
 */
export interface A2ATaskHistoryEvent {
  timestamp: string;
  event: string;
  data: any;
}

/**
 * A2A push notification configuration
 */
export interface A2APushNotificationConfig {
  url?: string;
  authentication?: {
    type: 'bearer' | 'basic';
    token?: string;
    username?: string;
    password?: string;
  };
}

/**
 * A2A task
 */
export interface A2ATask {
  id: string;
  status: A2ATaskStatus;
  artifacts: A2AArtifact[];
  history: A2ATaskHistoryEvent[];
  sessionId?: string;
  pushNotificationConfig?: A2APushNotificationConfig;
}

/**
 * A2A request
 */
export interface A2ARequest {
  method: string;
  params?: any;
  id?: string | number;
}

/**
 * A2A response
 */
export interface A2AResponse {
  jsonrpc: '2.0';
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
  id?: string | number | null;
}

/**
 * A2A method parameters
 */
export interface A2AMethodParams {
  [key: string]: any;
}

/**
 * Message send parameters
 */
export interface MessageSendParams extends A2AMethodParams {
  message: A2AMessage;
  sessionId?: string;
}

/**
 * Task get parameters
 */
export interface TaskGetParams extends A2AMethodParams {
  id: string;
}

/**
 * Task cancel parameters
 */
export interface TaskCancelParams extends A2AMethodParams {
  id: string;
}

/**
 * Set push notification config parameters
 */
export interface SetPushNotificationConfigParams extends A2AMethodParams {
  id: string;
  pushNotificationConfig: A2APushNotificationConfig;
}

/**
 * Get push notification config parameters
 */
export interface GetPushNotificationConfigParams extends A2AMethodParams {
  id: string;
}

/**
 * Task resubscribe parameters
 */
export interface TaskResubscribeParams extends A2AMethodParams {
  id: string;
}

// ====== Error Types ======

/**
 * Custom error class for validation errors
 */
export class ValidationError extends Error {
  public statusCode: number;
  public code: string;
  public details?: any;

  constructor(message: string, statusCode = 400, code = 'VALIDATION_ERROR', details?: any) {
    super(message);
    this.name = 'ValidationError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

/**
 * Custom error class for environment errors
 */
export class EnvironmentError extends Error {
  public statusCode: number;
  public code: string;

  constructor(message: string, code = 'ENVIRONMENT_ERROR') {
    super(message);
    this.name = 'EnvironmentError';
    this.statusCode = 500;
    this.code = code;
  }
}

/**
 * Custom error class for external API errors
 */
export class ExternalAPIError extends Error {
  public statusCode: number;
  public code: string;
  public service: string;

  constructor(message: string, service: string, code = 'EXTERNAL_API_ERROR') {
    super(message);
    this.name = 'ExternalAPIError';
    this.statusCode = 502;
    this.code = code;
    this.service = service;
  }
}

// ====== Configuration Types ======

/**
 * Server configuration
 */
export interface ServerConfig {
  port: number;
  host: string;
  timeout?: number;
  maxConnections?: number;
}

/**
 * Rate limiting configuration
 */
export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
}

/**
 * CORS configuration
 */
export interface CorsConfig {
  origin: string | string[];
  methods: string[];
  allowedHeaders: string[];
  credentials?: boolean;
}

/**
 * Application configuration
 */
export interface AppConfig {
  server: ServerConfig;
  cors: CorsConfig;
  rateLimit: RateLimitConfig;
  environment: string;
  version: string;
}

// ====== Utility Types ======

/**
 * Deep partial type for nested objects
 */
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

/**
 * Required fields from a type
 */
export type RequiredFields<T, K extends keyof T> = T & Required<Pick<T, K>>;

/**
 * Optional fields from a type
 */
export type OptionalFields<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

/**
 * Async function type
 */
export type AsyncFunction<T = void> = () => Promise<T>;

/**
 * Event handler type
 */
export type EventHandler<T = any> = (event: T) => void | Promise<void>;

/**
 * Middleware function type
 */
export type MiddlewareFunction<T = any, R = any> = (
  input: T,
  next?: () => Promise<R>
) => Promise<R>;

// ====== Express Types ======

/**
 * Enhanced Express request with additional properties
 */
export interface EnhancedRequest extends Express.Request {
  startTime?: number;
  requestId?: string;
  user?: {
    id: string;
    [key: string]: any;
  };
}

/**
 * Enhanced Express response with additional methods
 */
export interface EnhancedResponse extends Express.Response {
  sendSuccess?: <T>(data: T, statusCode?: number) => void;
  sendError?: (error: Error, statusCode?: number) => void;
  sendStream?: (data: any) => void;
}

// ====== Agent Types ======

/**
 * Agent configuration
 */
export interface AgentConfig {
  name: string;
  id: string;
  instructions: string;
  model: string;
  tools: Record<string, any>;
}

/**
 * Tool execution context
 */
export interface ToolExecutionContext {
  requestId?: string;
  sessionId?: string;
  userId?: string;
  metadata?: Record<string, any>;
}

/**
 * Tool input schema
 */
export interface ToolInputSchema {
  [key: string]: {
    type: string;
    description?: string;
    required?: boolean;
    default?: any;
  };
}

// ====== Database/Storage Types ======

/**
 * Storage interface for task persistence
 */
export interface TaskStorage {
  createTask(task: A2ATask): Promise<void>;
  getTask(taskId: string): Promise<A2ATask | undefined>;
  updateTask(taskId: string, task: A2ATask): Promise<void>;
  deleteTask(taskId: string): Promise<boolean>;
  getAllTasks(): Promise<A2ATask[]>;
  getTasksBySession(sessionId: string): Promise<A2ATask[]>;
}

/**
 * Cache interface
 */
export interface CacheInterface {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T, ttl?: number): Promise<void>;
  delete(key: string): Promise<boolean>;
  clear(): Promise<void>;
  exists(key: string): Promise<boolean>;
}

// ====== Monitoring/Logging Types ======

/**
 * Log levels
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

/**
 * Log entry
 */
export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  metadata?: Record<string, any>;
  error?: Error;
  requestId?: string;
  userId?: string;
}

/**
 * Metrics data
 */
export interface MetricsData {
  timestamp: string;
  [key: string]: number | string;
}

/**
 * Performance metrics
 */
export interface PerformanceMetrics {
  requestCount: number;
  errorCount: number;
  averageResponseTime: number;
  memoryUsage: NodeJS.MemoryUsage;
  uptime: number;
  activeConnections: number;
}

// ====== Security Types ======

/**
 * Authentication token
 */
export interface AuthToken {
  token: string;
  type: 'bearer' | 'basic';
  expiresAt?: string;
  scopes?: string[];
}

/**
 * User permissions
 */
export interface UserPermissions {
  canRead: boolean;
  canWrite: boolean;
  canDelete: boolean;
  canAdmin: boolean;
}

/**
 * Security context
 */
export interface SecurityContext {
  isAuthenticated: boolean;
  userId?: string;
  permissions?: UserPermissions;
  token?: AuthToken;
  ipAddress?: string;
  userAgent?: string;
}