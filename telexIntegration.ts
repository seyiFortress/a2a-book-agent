// telexIntegration.ts

import { Response } from 'express';
import { bookExtractorAgent } from './bookAgent.js';
import {
  ValidationError,
  ExternalAPIError,
  A2AErrorHandler,
  schemas
} from './validation.js';
import { InputSanitizer } from './validation.js';
import { createLogger } from '@mastra/core/logger';

// Types for Telex.im A2A protocol
export interface TelexMessage {
  role: 'user' | 'assistant';
  parts: Array<{
    type: 'text' | 'file' | 'data';
    text?: string;
    file?: any;
    data?: any;
  }>;
}

export interface TelexTaskStatus {
  state: 'working' | 'completed' | 'canceled';
  timestamp: string;
  message?: TelexMessage;
}

export interface TelexArtifact {
  type: string;
  data: any;
  timestamp: string;
  name?: string;
}

export interface TelexTask {
  id: string;
  status: TelexTaskStatus;
  artifacts: TelexArtifact[];
  history: any[];
  sessionId?: string;
  pushNotificationConfig?: {
    url?: string;
    authentication?: {
      type: 'bearer' | 'basic';
      token?: string;
      username?: string;
      password?: string;
    };
  };
}

export interface TelexRequest {
  method: string;
  params?: any;
  id?: string | number;
}

export interface TelexResponse {
  jsonrpc: '2.0';
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
  id?: string | number | null;
}

// Mastra-based task store for A2A operations
export class TelexTaskStore {
  private logger: any;
  private taskCache: Map<string, TelexTask> = new Map();

  constructor() {
    // Use createLogger directly to avoid circular dependency
    this.logger = createLogger({
      name: 'TelexIntegration',
      level: 'debug'
    });
  }

  async createTask(task: TelexTask): Promise<void> {
    try {
      // Use in-memory cache as fallback since Mastra's storage is optimized for agent/workflow data
      this.taskCache.set(task.id, task);
      this.logger.info(`Task created: ${task.id}`, { taskId: task.id, sessionId: task.sessionId });
    } catch (error) {
      this.logger.error(`Failed to create task: ${task.id}`, { error, taskId: task.id });
      throw error;
    }
  }

  async getTask(taskId: string): Promise<TelexTask | undefined> {
    try {
      const task = this.taskCache.get(taskId);
      this.logger.debug(`Retrieved task: ${taskId}`, { taskId, found: !!task });
      return task;
    } catch (error) {
      this.logger.error(`Failed to get task: ${taskId}`, { error, taskId });
      throw error;
    }
  }

  async updateTask(taskId: string, task: TelexTask): Promise<void> {
    try {
      this.taskCache.set(taskId, task);
      this.logger.info(`Task updated: ${taskId}`, { taskId, state: task.status.state });
    } catch (error) {
      this.logger.error(`Failed to update task: ${taskId}`, { error, taskId });
      throw error;
    }
  }

  async getAllTasks(): Promise<TelexTask[]> {
    try {
      return Array.from(this.taskCache.values());
    } catch (error) {
      this.logger.error('Failed to get all tasks', { error });
      throw error;
    }
  }

  async deleteTask(taskId: string): Promise<boolean> {
    try {
      const deleted = this.taskCache.delete(taskId);
      if (deleted) {
        this.logger.info(`Task deleted: ${taskId}`, { taskId });
      }
      return deleted;
    } catch (error) {
      this.logger.error(`Failed to delete task: ${taskId}`, { error, taskId });
      throw error;
    }
  }
}

// Telex.im A2A Protocol Handler Class
export class TelexIntegrationHandler {
  private taskStore: TelexTaskStore;
  private logger: any;

  constructor(taskStore?: TelexTaskStore) {
    this.taskStore = taskStore || new TelexTaskStore();
    // Use createLogger directly to avoid circular dependency
    this.logger = createLogger({
      name: 'TelexIntegration',
      level: 'debug'
    });
  }

  /**
   * Validates the structure of a Telex.im A2A request
   */
  validateRequest(request: TelexRequest): { valid: boolean; error?: TelexResponse } {
    try {
      // Validate using zod schema
      schemas.telexRequest.parse(request);
      
      // Additional validation for method
      if (!request.method || typeof request.method !== 'string') {
        return {
          valid: false,
          error: A2AErrorHandler.createErrorResponse(
            -32600,
            'Invalid Request: method is required and must be a string',
            request.id
          )
        };
      }
      
      // Validate method format
      if (!/^[a-zA-Z0-9_\/-]+$/.test(request.method)) {
        return {
          valid: false,
          error: A2AErrorHandler.createErrorResponse(
            -32600,
            'Invalid Request: method contains invalid characters',
            request.id
          )
        };
      }
      
      return { valid: true };
    } catch (error) {
      if (error instanceof ValidationError) {
        return {
          valid: false,
          error: A2AErrorHandler.handleValidationError(error, request.id)
        };
      }
      
      return {
        valid: false,
        error: A2AErrorHandler.createErrorResponse(
          -32600,
          'Invalid Request format',
          request.id,
          error instanceof Error ? error.message : 'Unknown error'
        )
      };
    }
  }

  /**
   * Extracts search query from Telex.im message format
   */
  extractSearchQuery(message: TelexMessage): string {
    try {
      // Validate message structure
      if (!message.parts || !Array.isArray(message.parts)) {
        throw new ValidationError('Message parts must be a non-empty array');
      }

      const textPart = message.parts.find(part => part.type === 'text' && part.text);
      if (!textPart || !textPart.text) {
        throw new ValidationError('Message must contain a text part with content');
      }

      const messageText = textPart.text;
      if (!messageText || messageText.trim().length === 0) {
        throw new ValidationError('Message text cannot be empty');
      }

      // Sanitize the message text
      const sanitizedText = InputSanitizer.sanitizeString(messageText);
      
      // Extract search query
      let searchQuery = '';
      if (sanitizedText.includes('Find a book with: query:')) {
        searchQuery = sanitizedText.replace('Find a book with: query:', '').trim();
      } else {
        searchQuery = sanitizedText.trim();
      }

      // Validate and sanitize the search query
      return InputSanitizer.sanitizeSearchQuery(searchQuery);
    } catch (error) {
      if (error instanceof ValidationError) {
        throw error;
      }
      throw new ValidationError('Failed to extract search query from message');
    }
  }

  /**
   * Formats book extraction result for Telex.im response
   */
  formatBookResponse(result: any): string {
    try {
      if (result.error) {
        let errorMessage = `❌ Error: ${result.error}`;
        
        // Add suggestions if available
        if (result.suggestions && Array.isArray(result.suggestions)) {
          errorMessage += '\n\n💡 Suggestions:\n';
          result.suggestions.forEach((suggestion: string, index: number) => {
            errorMessage += `${index + 1}. ${suggestion}\n`;
          });
        }
        
        // Add error code if available
        if (result.code) {
          errorMessage += `\n\nError Code: ${result.code}`;
        }
        
        return errorMessage;
      }
      
      // Validate required fields
      if (!result.title || !result.authors || !result.excerpt) {
        throw new ValidationError('Invalid book result format: missing required fields');
      }
      
      const { title, authors, excerpt, source, downloadCount, languages, subjects } = result;
      
      let response = `📚 **${title}**\n\n*By ${authors}*\n\n${excerpt}`;
      
      // Add additional metadata if available
      if (source) {
        response += `\n\n*Source: ${source}*`;
      }
      
      if (downloadCount && typeof downloadCount === 'number') {
        response += `\n*Downloads: ${downloadCount.toLocaleString()}*`;
      }
      
      if (languages && Array.isArray(languages) && languages.length > 0) {
        response += `\n*Languages: ${languages.join(', ')}*`;
      }
      
      if (subjects && Array.isArray(subjects) && subjects.length > 0) {
        response += `\n*Topics: ${subjects.slice(0, 5).join(', ')}${subjects.length > 5 ? '...' : ''}*`;
      }
      
      response += '\n\n*Excerpt from Project Gutenberg - Public Domain*';
      
      return response;
    } catch (error) {
      if (error instanceof ValidationError) {
        return `❌ Error: ${error.message}`;
      }
      return `❌ Error: Failed to format book response`;
    }
  }

  /**
   * Creates a new task with initial status
   */
  createTask(searchQuery: string, message: TelexMessage, sessionId?: string): TelexTask {
    try {
      // Validate inputs
      if (!searchQuery || typeof searchQuery !== 'string') {
        throw new ValidationError('Search query is required and must be a string');
      }
      
      if (!message || !message.parts || !Array.isArray(message.parts)) {
        throw new ValidationError('Invalid message structure');
      }
      
      // Generate secure task ID
      const timestamp = Date.now();
      const randomSuffix = Math.random().toString(36).substring(2, 11);
      const taskId = `task_${timestamp}_${randomSuffix}`;
      
      // Validate session ID if provided
      let validSessionId = sessionId;
      if (sessionId) {
        validSessionId = InputSanitizer.sanitizeString(sessionId);
        if (!validSessionId) {
          throw new ValidationError('Invalid session ID');
        }
      }
      
      return {
        id: taskId,
        sessionId: validSessionId || `session_${timestamp}`,
        status: {
          state: 'working',
          timestamp: new Date().toISOString(),
          message: {
            role: 'user',
            parts: message.parts
          }
        },
        artifacts: [],
        history: [{
          timestamp: new Date().toISOString(),
          event: 'task_created',
          data: {
            searchQuery: InputSanitizer.sanitizeString(searchQuery),
            userAgent: 'A2A-Book-Agent/1.0.0'
          }
        }]
      };
    } catch (error) {
      if (error instanceof ValidationError) {
        throw error;
      }
      throw new ValidationError('Failed to create task');
    }
  }

  /**
   * Updates task with completion results
   */
  async completeTask(task: TelexTask, result: any): Promise<void> {
    task.status = { 
      state: 'completed', 
      timestamp: new Date().toISOString(),
      message: {
        role: 'assistant',
        parts: [{
          type: 'text',
          text: this.formatBookResponse(result)
        }]
      }
    };
    
    task.artifacts = [{
      type: 'book_excerpt',
      name: 'Book Excerpt',
      data: result,
      timestamp: new Date().toISOString()
    }];
    
    task.history.push({
      timestamp: new Date().toISOString(),
      event: 'task_completed',
      data: { result }
    });
    
    await this.taskStore.updateTask(task.id, task);
  }

  /**
   * Handles message/send method
   */
  async handleMessageSend(params: any, id: string | number): Promise<TelexResponse> {
    try {
      // Validate parameters using zod schema
      if (!params) {
        return A2AErrorHandler.createErrorResponse(
          -32602,
          'Invalid params: params object is required',
          id
        );
      }

      // Validate message structure
      try {
        schemas.telexMessage.parse(params.message);
      } catch (error) {
        return A2AErrorHandler.handleValidationError(
          new ValidationError('Invalid message structure', 400, 'VALIDATION_ERROR', error),
          id
        );
      }

      // Extract and validate search query
      let searchQuery: string;
      try {
        searchQuery = this.extractSearchQuery(params.message);
      } catch (error) {
        return A2AErrorHandler.handleValidationError(
          error as ValidationError,
          id
        );
      }

      // Create and store task
      let task: TelexTask;
      try {
        task = this.createTask(searchQuery, params.message, params.sessionId);
        await this.taskStore.createTask(task);
      } catch (error) {
        return A2AErrorHandler.handleValidationError(
          error as ValidationError,
          id
        );
      }

      // Process the book extraction with timeout
      this.logger.info(`Processing book extraction`, { searchQuery, taskId: task.id });
      let result: any;
      
      try {
        // Add timeout to prevent hanging requests
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Request timeout')), 30000);
        });
        
        const extractionPromise = bookExtractorAgent.generate(`Find a book with: query: ${searchQuery}`);
        result = await Promise.race([extractionPromise, timeoutPromise]);
        
        this.logger.debug(`Book extraction completed`, {
          taskId: task.id,
          success: true,
          resultType: result ? 'success' : 'empty'
        });
      } catch (error) {
        this.logger.debug(`Book extraction failed`, {
          taskId: task.id,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        
        if (error instanceof Error && error.message === 'Request timeout') {
          this.logger.error(`Book extraction timed out`, { taskId: task.id, searchQuery, timeout: 30000 });
          return A2AErrorHandler.createErrorResponse(
            -32603,
            'Book extraction request timed out',
            id,
            { timeout: 30000 }
          );
        }
        
        if (error instanceof ExternalAPIError) {
          this.logger.error(`External API error during book extraction`, {
            taskId: task.id,
            searchQuery,
            service: error.service,
            code: error.code,
            error: error.message
          });
          return A2AErrorHandler.createErrorResponse(
            -32603,
            `External API error: ${error.message}`,
            id,
            { service: error.service, code: error.code }
          );
        }
        
        this.logger.error(`Internal error during book extraction`, {
          taskId: task.id,
          searchQuery,
          error: error instanceof Error ? error.message : error
        });
        return A2AErrorHandler.handleInternalError(error as Error, id);
      }

      // Update task with results
      try {
        await this.completeTask(task, result);
      } catch (error) {
        this.logger.error(`Failed to complete task`, {
          taskId: task.id,
          error: error instanceof Error ? error.message : error
        });
        // Continue with response even if task completion fails
      }

      // Return response
      return {
        jsonrpc: '2.0',
        result: {
          task,
          message: task.status.message,
          processingTime: Date.now() - parseInt(task.id.split('_')[1], 10)
        },
        id
      };
    } catch (error) {
      this.logger.error(`Message send error`, {
        error: error instanceof Error ? error.message : error,
        id,
        method: 'message/send'
      });
      return A2AErrorHandler.handleInternalError(error as Error, id);
    }
  }

  /**
   * Handles message/stream method with Server-Sent Events
   */
  async handleMessageStream(params: any, id: string | number, res: Response): Promise<void> {
    let task: TelexTask | null = null;
    
    try {
      // Validate parameters
      if (!params || !params.message) {
        this.sendStreamError(res, id, -32602, 'Invalid params: message is required');
        return;
      }

      // Validate message structure
      try {
        schemas.telexMessage.parse(params.message);
      } catch (error) {
        this.sendStreamError(res, id, -32602, 'Invalid message structure', error);
        return;
      }

      // Set up Server-Sent Events for streaming with proper headers
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'X-Accel-Buffering': 'no', // Disable nginx buffering
      });

      // Extract and validate search query
      let searchQuery: string;
      try {
        searchQuery = this.extractSearchQuery(params.message);
      } catch (error) {
        this.sendStreamError(res, id, -32602, 'Could not extract search query', error);
        return;
      }

      // Create and store task
      try {
        task = this.createTask(searchQuery, params.message, params.sessionId);
        await this.taskStore.createTask(task);
      } catch (error) {
        this.sendStreamError(res, id, -32602, 'Failed to create task', error);
        return;
      }

      // Send initial task update
      this.sendStreamData(res, {
        jsonrpc: '2.0',
        result: {
          task,
          status: 'started',
          timestamp: new Date().toISOString()
        },
        id
      });

      // Process the book extraction with timeout and progress updates
      this.logger.info(`Processing book extraction (stream)`, { searchQuery, taskId: task.id });
      
      try {
        // Send progress update
        this.sendStreamData(res, {
          jsonrpc: '2.0',
          result: {
            taskId: task.id,
            status: 'searching',
            message: 'Searching for books...',
            timestamp: new Date().toISOString()
          },
          id
        });

        // Add timeout to prevent hanging requests
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Request timeout')), 30000);
        });
        
        const extractionPromise = bookExtractorAgent.generate(`Find a book with: query: ${searchQuery}`);
        const result = await Promise.race([extractionPromise, timeoutPromise]);

        // Send progress update
        this.sendStreamData(res, {
          jsonrpc: '2.0',
          result: {
            taskId: task.id,
            status: 'processing',
            message: 'Processing book content...',
            timestamp: new Date().toISOString()
          },
          id
        });

        // Update task with results
        await this.completeTask(task, result);

        this.logger.debug(`Book extraction (stream) completed`, {
          taskId: task.id,
          success: true,
          resultType: result ? 'success' : 'empty'
        });

        // Send final task update
        this.sendStreamData(res, {
          jsonrpc: '2.0',
          result: {
            task,
            status: 'completed',
            timestamp: new Date().toISOString()
          },
          id
        });

        // Send message response
        this.sendStreamData(res, {
          jsonrpc: '2.0',
          result: {
            taskId: task.id,
            message: task.status.message,
            processingTime: Date.now() - parseInt(task.id.split('_')[1], 10)
          },
          id
        });

      } catch (error) {
        this.logger.debug(`Book extraction (stream) failed`, {
          taskId: task.id,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        
        if (error instanceof Error && error.message === 'Request timeout') {
          this.logger.error(`Book extraction timed out (stream)`, { taskId: task.id, searchQuery, timeout: 30000 });
          this.sendStreamError(res, id, -32603, 'Book extraction request timed out', { timeout: 30000 });
          return;
        }
        
        if (error instanceof ExternalAPIError) {
          this.logger.error(`External API error during book extraction (stream)`, {
            taskId: task.id,
            searchQuery,
            service: error.service,
            code: error.code,
            error: error.message
          });
          this.sendStreamError(res, id, -32603, `External API error: ${error.message}`, {
            service: error.service,
            code: error.code
          });
          return;
        }
        
        this.logger.error(`Error during book extraction (stream)`, {
          taskId: task.id,
          searchQuery,
          error: error instanceof Error ? error.message : error
        });
        this.sendStreamError(res, id, -32603, 'Error during book extraction', error);
        return;
      }

      // Send completion signal
      this.sendStreamData(res, {
        jsonrpc: '2.0',
        result: {
          taskId: task.id,
          status: 'stream_complete',
          timestamp: new Date().toISOString()
        },
        id
      });

      res.end();
    } catch (error) {
      this.logger.error(`Message stream error`, {
        error: error instanceof Error ? error.message : error,
        id,
        taskId: (task as TelexTask | null)?.id || 'unknown',
        method: 'message/stream'
      });
      
      // Update task status if it was created
      if (task) {
        try {
          (task as TelexTask).status = {
            state: 'canceled',
            timestamp: new Date().toISOString(),
            message: {
              role: 'assistant',
              parts: [{
                type: 'text',
                text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
              }]
            }
          };
          const taskId = (task as TelexTask).id;
          await this.taskStore.updateTask(taskId, task as TelexTask);
        } catch (updateError) {
          this.logger.error(`Failed to update task status after error`, {
            taskId: (task as TelexTask | null)?.id || 'unknown',
            error: updateError instanceof Error ? updateError.message : updateError
          });
        }
      }
      
      this.sendStreamError(res, id, -32603, 'Internal error during message streaming', error);
      res.end();
    }
  }

  /**
   * Helper method to send data via Server-Sent Events
   */
  private sendStreamData(res: Response, data: any): void {
    try {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
      this.logger.debug('Stream data sent', {
        method: data.result?.status || 'unknown',
        taskId: data.result?.taskId || 'unknown'
      });
    } catch (error) {
      this.logger.error('Failed to send stream data', {
        error: error instanceof Error ? error.message : error
      });
    }
  }

  /**
   * Helper method to send error via Server-Sent Events
   */
  private sendStreamError(res: Response, id: string | number, code: number, message: string, data?: any): void {
    try {
      const errorResponse = A2AErrorHandler.createErrorResponse(code, message, id, data);
      this.sendStreamData(res, errorResponse);
      this.logger.error('Stream error sent', { code, message, id, data });
    } catch (error) {
      this.logger.error('Failed to send stream error', {
        error: error instanceof Error ? error.message : error,
        code,
        message,
        id
      });
    }
  }

  /**
   * Handles tasks/get method
   */
  async handleTaskGet(params: any, id: string | number): Promise<TelexResponse> {
    try {
      // Validate parameters
      if (!params || !params.id) {
        return A2AErrorHandler.createErrorResponse(
          -32602,
          'Invalid params: task id is required',
          id
        );
      }

      // Validate task ID format
      let taskId: string;
      try {
        taskId = schemas.taskId.parse(params.id);
      } catch (error) {
        return A2AErrorHandler.handleValidationError(
          new ValidationError('Invalid task ID format'),
          id
        );
      }

      // Retrieve task
      const task = await this.taskStore.getTask(taskId);
      
      if (!task) {
        return A2AErrorHandler.handleTaskNotFound(taskId, id);
      }

      // Add task metadata
      const taskWithMetadata = {
        ...task,
        retrievedAt: new Date().toISOString(),
        age: Date.now() - parseInt(task.id.split('_')[1], 10)
      };

      return {
        jsonrpc: '2.0',
        result: taskWithMetadata,
        id
      };
    } catch (error) {
      this.logger.error(`Task get error`, {
        error: error instanceof Error ? error.message : error,
        id,
        method: 'tasks/get'
      });
      return A2AErrorHandler.handleInternalError(error as Error, id);
    }
  }

  /**
   * Handles tasks/cancel method
   */
  async handleTaskCancel(params: any, id: string | number): Promise<TelexResponse> {
    try {
      // Validate parameters
      if (!params || !params.id) {
        return A2AErrorHandler.createErrorResponse(
          -32602,
          'Invalid params: task id is required',
          id
        );
      }

      // Validate task ID format
      let taskId: string;
      try {
        taskId = schemas.taskId.parse(params.id);
      } catch (error) {
        return A2AErrorHandler.handleValidationError(
          new ValidationError('Invalid task ID format'),
          id
        );
      }

      // Retrieve task
      const task = await this.taskStore.getTask(taskId);
      
      if (!task) {
        return A2AErrorHandler.handleTaskNotFound(taskId, id);
      }

      // Check if task can be canceled
      if (task.status.state === 'completed') {
        return A2AErrorHandler.createErrorResponse(
          -32002,
          `Task not cancelable: ${taskId} (already completed)`,
          id,
          { currentState: task.status.state }
        );
      }

      if (task.status.state === 'canceled') {
        return A2AErrorHandler.createErrorResponse(
          -32002,
          `Task already canceled: ${taskId}`,
          id,
          { currentState: task.status.state }
        );
      }

      // Update task status to canceled
      task.status = {
        state: 'canceled',
        timestamp: new Date().toISOString(),
        message: {
          role: 'assistant',
          parts: [{
            type: 'text',
            text: 'Task was canceled by user request'
          }]
        }
      };
      
      // Add cancellation event to history
      task.history.push({
        timestamp: new Date().toISOString(),
        event: 'task_canceled',
        data: {
          reason: 'user_request',
          canceledAt: new Date().toISOString()
        }
      });
      
      await this.taskStore.updateTask(taskId, task);

      return {
        jsonrpc: '2.0',
        result: {
          ...task,
          canceledAt: new Date().toISOString()
        },
        id
      };
    } catch (error) {
      this.logger.error(`Task cancel error`, {
        error: error instanceof Error ? error.message : error,
        id,
        method: 'tasks/cancel'
      });
      return A2AErrorHandler.handleInternalError(error as Error, id);
    }
  }

  /**
   * Handles tasks/setPushNotificationConfig method
   */
  async handleSetTaskPushNotificationConfig(params: any, id: string | number): Promise<TelexResponse> {
    try {
      // Validate parameters
      if (!params || !params.id) {
        return A2AErrorHandler.createErrorResponse(
          -32602,
          'Invalid params: task id is required',
          id
        );
      }

      if (!params.pushNotificationConfig) {
        return A2AErrorHandler.createErrorResponse(
          -32602,
          'Invalid params: pushNotificationConfig is required',
          id
        );
      }

      // Validate task ID format
      let taskId: string;
      try {
        taskId = schemas.taskId.parse(params.id);
      } catch (error) {
        return A2AErrorHandler.handleValidationError(
          new ValidationError('Invalid task ID format'),
          id
        );
      }

      // Validate push notification config
      let pushNotificationConfig: any;
      try {
        pushNotificationConfig = schemas.pushNotificationConfig.parse(params.pushNotificationConfig);
      } catch (error) {
        return A2AErrorHandler.handleValidationError(
          new ValidationError('Invalid push notification configuration'),
          id
        );
      }

      // Retrieve task
      const task = await this.taskStore.getTask(taskId);
      
      if (!task) {
        return A2AErrorHandler.handleTaskNotFound(taskId, id);
      }

      // Validate URL if provided
      if (pushNotificationConfig.url) {
        try {
          new URL(pushNotificationConfig.url);
        } catch {
          return A2AErrorHandler.createErrorResponse(
            -32602,
            'Invalid URL in push notification configuration',
            id
          );
        }
      }

      // Update task with push notification config
      task.pushNotificationConfig = pushNotificationConfig;
      
      // Add configuration event to history
      task.history.push({
        timestamp: new Date().toISOString(),
        event: 'push_notification_config_set',
        data: {
          configuredAt: new Date().toISOString(),
          hasUrl: !!pushNotificationConfig.url,
          hasAuth: !!pushNotificationConfig.authentication
        }
      });
      
      await this.taskStore.updateTask(taskId, task);

      return {
        jsonrpc: '2.0',
        result: {
          task,
          pushNotificationConfig: task.pushNotificationConfig,
          configuredAt: new Date().toISOString()
        },
        id
      };
    } catch (error) {
      this.logger.error(`Set task push notification config error`, {
        error: error instanceof Error ? error.message : error,
        id,
        method: 'tasks/setPushNotificationConfig'
      });
      return A2AErrorHandler.handleInternalError(error as Error, id);
    }
  }

  /**
   * Handles tasks/getPushNotificationConfig method
   */
  async handleGetTaskPushNotificationConfig(params: any, id: string | number): Promise<TelexResponse> {
    try {
      // Validate parameters
      if (!params || !params.id) {
        return A2AErrorHandler.createErrorResponse(
          -32602,
          'Invalid params: task id is required',
          id
        );
      }

      // Validate task ID format
      let taskId: string;
      try {
        taskId = schemas.taskId.parse(params.id);
      } catch (error) {
        return A2AErrorHandler.handleValidationError(
          new ValidationError('Invalid task ID format'),
          id
        );
      }

      // Retrieve task
      const task = await this.taskStore.getTask(taskId);
      
      if (!task) {
        return A2AErrorHandler.handleTaskNotFound(taskId, id);
      }

      // Return task with push notification config
      return {
        jsonrpc: '2.0',
        result: {
          taskId: task.id,
          pushNotificationConfig: task.pushNotificationConfig || null,
          hasConfig: !!task.pushNotificationConfig,
          retrievedAt: new Date().toISOString()
        },
        id
      };
    } catch (error) {
      this.logger.error(`Get task push notification config error`, {
        error: error instanceof Error ? error.message : error,
        id,
        method: 'tasks/getPushNotificationConfig'
      });
      return A2AErrorHandler.handleInternalError(error as Error, id);
    }
  }

  /**
   * Handles tasks/resubscribe method
   */
  async handleTaskResubscribe(params: any, id: string | number): Promise<TelexResponse> {
    try {
      // Validate parameters
      if (!params || !params.id) {
        return A2AErrorHandler.createErrorResponse(
          -32602,
          'Invalid params: task id is required',
          id
        );
      }

      // Validate task ID format
      let taskId: string;
      try {
        taskId = schemas.taskId.parse(params.id);
      } catch (error) {
        return A2AErrorHandler.handleValidationError(
          new ValidationError('Invalid task ID format'),
          id
        );
      }

      // Retrieve task
      const task = await this.taskStore.getTask(taskId);
      
      if (!task) {
        return A2AErrorHandler.handleTaskNotFound(taskId, id);
      }

      // Add resubscription event to history
      task.history.push({
        timestamp: new Date().toISOString(),
        event: 'task_resubscribed',
        data: {
          resubscribedAt: new Date().toISOString(),
          currentState: task.status.state
        }
      });
      
      // Update task
      await this.taskStore.updateTask(taskId, task);

      // Return current task state with resubscription info
      return {
        jsonrpc: '2.0',
        result: {
          task,
          resubscribed: true,
          resubscribedAt: new Date().toISOString(),
          currentState: task.status.state,
          message: 'Successfully resubscribed to task updates'
        },
        id
      };
    } catch (error) {
      this.logger.error(`Task resubscribe error`, {
        error: error instanceof Error ? error.message : error,
        id,
        method: 'tasks/resubscribe'
      });
      return A2AErrorHandler.handleInternalError(error as Error, id);
    }
  }

  /**
   * Main router for Telex.im A2A methods
   */
  async routeRequest(request: TelexRequest, res?: Response): Promise<TelexResponse | void> {
    try {
      // Validate request structure
      const validation = this.validateRequest(request);
      if (!validation.valid) {
        return validation.error;
      }

      const { method, params, id } = request;
      const requestId = id || 'default';

      // Log request for debugging
      this.logger.info(`Routing A2A request`, { method, id: requestId });

      // Route to appropriate handler
      switch (method) {
        case 'message/send':
          return await this.handleMessageSend(params, requestId);
          
        case 'message/stream':
          if (res) {
            await this.handleMessageStream(params, requestId, res);
            return;
          } else {
            return A2AErrorHandler.createErrorResponse(
              -32603,
              'Response object required for streaming',
              requestId
            );
          }
          
        case 'tasks/get':
          return await this.handleTaskGet(params, requestId);
          
        case 'tasks/cancel':
          return await this.handleTaskCancel(params, requestId);
          
        case 'tasks/setPushNotificationConfig':
          return await this.handleSetTaskPushNotificationConfig(params, requestId);
          
        case 'tasks/getPushNotificationConfig':
          return await this.handleGetTaskPushNotificationConfig(params, requestId);
          
        case 'tasks/resubscribe':
          return await this.handleTaskResubscribe(params, requestId);
          
        default:
          return A2AErrorHandler.handleMethodNotFound(method, requestId);
      }
    } catch (error) {
      this.logger.error(`Request routing error`, {
        error: error instanceof Error ? error.message : error,
        method: request.method,
        id: request.id
      });
      return A2AErrorHandler.handleInternalError(error as Error, request.id);
    }
  }
}

// Export singleton instance for easy use
export const telexIntegrationHandler = new TelexIntegrationHandler();