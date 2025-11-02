// a2a-agent-route.ts

import { registerApiRoute } from '@mastra/core/server';
import { Context, Handler, MiddlewareHandler } from 'hono';
import { telexIntegrationHandler, TelexRequest } from './telexIntegration.js';
import { schemas } from './validation.js';
import { mastra } from './mastra.js';

/**
 * A2A Agent Route Configuration for Mastra
 * 
 * This route handles the A2A protocol endpoints for Telex.im integration,
 * specifically the `/a2a/:agentId` endpoint and related functionality.
 * It leverages the existing Telex A2A protocol implementation from telexIntegration.ts.
 */

// A2A Route Handler
const a2aRouteHandler: Handler = async (c: Context) => {
  const logger = mastra.getLogger();
  
  try {
    const { agentId } = c.req.param();
    const requestBody = await c.req.json();
    const { method, params, id } = requestBody;
    
    // Validate agentId parameter
    if (!agentId || typeof agentId !== 'string') {
      logger.warn('Invalid agent ID parameter', { agentId, method, id });
      return c.json({
        jsonrpc: '2.0',
        error: {
          code: -32600,
          message: 'Invalid agent ID parameter'
        },
        id: id || null
      }, 400);
    }
    
    logger.info('A2A Request received', { agentId, method, id });
    
    // Create Telex request object
    const telexRequest: TelexRequest = {
      method,
      params,
      id
    };
    
    // Route request through Telex integration handler
    // For streaming responses, we need to pass the response object
    // Cast to any to bypass type checking since telexIntegrationHandler expects Express Response
    const response = await telexIntegrationHandler.routeRequest(telexRequest, c.res as any);
    
    // If we got a response (non-streaming), send it
    if (response) {
      logger.debug('A2A Response sent', { agentId, method, id, hasResult: !!response.result });
      return c.json(response);
    }
    // For streaming responses, handler will send response directly
  } catch (error) {
    logger.error('A2A Error in route handler', {
      error: error instanceof Error ? error.message : error,
      stack: error instanceof Error ? error.stack : undefined
    });
    return c.json({
      jsonrpc: '2.0',
      error: {
        code: -32603,
        message: 'Internal error',
        data: error instanceof Error ? error.message : 'Unknown error'
      },
      id: null
    }, 500);
  }
};

// Create the A2A API route configuration
const a2aRouteConfig = {
  method: 'POST' as const,
  handler: a2aRouteHandler,
  // Add validation middleware to ensure the request follows the Telex A2A protocol
  // Create Hono-compatible validation middleware
  middleware: [
    async (c: Context, next: () => Promise<void>) => {
      try {
        const body = await c.req.json();
        schemas.telexRequest.parse(body);
        await next();
      } catch (error) {
        if (error instanceof Error) {
          return c.json({
            jsonrpc: '2.0',
            error: {
              code: -32600,
              message: 'Invalid Request',
              data: error.message
            },
            id: null
          }, 400);
        }
        return c.json({
          jsonrpc: '2.0',
          error: {
            code: -32600,
            message: 'Invalid Request'
          },
          id: null
        }, 400);
      }
    }
  ],
  // OpenAPI documentation for the route
  openapi: {
    description: 'A2A Protocol endpoint for Telex.im integration',
    summary: 'Handle A2A protocol requests for agent communication',
    tags: ['A2A'],
    requestBody: {
      description: 'A2A protocol request following JSON-RPC 2.0 format',
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              jsonrpc: {
                type: 'string',
                enum: ['2.0'],
                description: 'JSON-RPC version'
              },
              method: {
                type: 'string',
                description: 'A2A method name (e.g., message/send, message/stream, tasks/get)'
              },
              params: {
                type: 'object',
                description: 'Parameters for the A2A method'
              },
              id: {
                oneOf: [
                  { type: 'string' },
                  { type: 'number' },
                  { type: 'null' }
                ],
                description: 'Request identifier for correlation'
              }
            },
            required: ['jsonrpc', 'method']
          }
        }
      }
    },
    responses: {
      200: {
        description: 'Successful A2A response',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                jsonrpc: {
                  type: 'string',
                  enum: ['2.0']
                },
                result: {
                  type: 'object',
                  description: 'Result of the A2A method call'
                },
                id: {
                  oneOf: [
                    { type: 'string' },
                    { type: 'number' },
                    { type: 'null' }
                  ]
                }
              }
            }
          }
        }
      },
      400: {
        description: 'Invalid request',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                jsonrpc: {
                  type: 'string',
                  enum: ['2.0']
                },
                error: {
                  type: 'object',
                  properties: {
                    code: {
                      type: 'number'
                    },
                    message: {
                      type: 'string'
                    },
                    data: {
                      type: 'object'
                    }
                  }
                },
                id: {
                  oneOf: [
                    { type: 'string' },
                    { type: 'number' },
                    { type: 'null' }
                  ]
                }
              }
            }
          }
        }
      }
    }
  },
  // This route does not require authentication as it's part of the A2A protocol
};

// Register the A2A API route with Mastra
export const a2aAgentRoute = registerApiRoute('a2a/:agentId', a2aRouteConfig);

// Export the route configuration for registration with Mastra's server
export default a2aAgentRoute;