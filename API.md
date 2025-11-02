# A2A Book Agent API Documentation

This document provides comprehensive information about the A2A Book Agent's REST API endpoints and A2A protocol methods.

## Table of Contents

1. [Base URL](#base-url)
2. [Authentication](#authentication)
3. [REST API Endpoints](#rest-api-endpoints)
4. [A2A Protocol Methods](#a2a-protocol-methods)
5. [Request/Response Formats](#requestresponse-formats)
6. [Error Codes](#error-codes)
7. [Rate Limiting](#rate-limiting)
8. [Security](#security)

## Base URL

```
Development: http://localhost:4111
Production: https://your-domain.com
```

## Authentication

Currently, the A2A Book Agent does not require authentication for its public endpoints. However, rate limiting is applied to prevent abuse.

## REST API Endpoints

### 1. Health Check

Check the health status of the service.

**Endpoint**: `GET /health`

**Description**: Returns the current health status and system information.

**Request Parameters**: None

**Response**:

```json
{
  "status": "healthy",
  "timestamp": "2024-01-01T12:00:00.000Z",
  "service": "a2a-book-agent",
  "version": "1.0.0",
  "environment": "development",
  "uptime": 3600,
  "memory": {
    "rss": 50331648,
    "heapTotal": 20971520,
    "heapUsed": 15728640,
    "external": 1048576
  },
  "dependencies": {
    "mastra": "OK",
    "express": "OK"
  }
}
```

**Status Codes**:
- `200 OK` - Service is healthy
- `500 Internal Server Error` - Service is unhealthy

### 2. Book Extraction

Extract excerpts from public domain books.

**Endpoint**: `POST /api/extract-book`

**Description**: Searches for a public domain book and returns an excerpt.

**Request Body**:

```json
{
  "searchQuery": "Sherlock Holmes"
}
```

**Request Parameters**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| searchQuery | string | Yes | Book title, author, or keyword (1-200 characters) |

**Success Response**:

```json
{
  "success": true,
  "data": {
    "title": "The Adventures of Sherlock Holmes",
    "authors": "Arthur Conan Doyle",
    "excerpt": "To Sherlock Holmes she is always the woman. I have seldom heard him mention her under any other name...",
    "source": "Project Gutenberg",
    "downloadCount": 15743,
    "languages": ["en"],
    "subjects": ["Detective and mystery stories", "Fiction"]
  },
  "timestamp": "2024-01-01T12:00:00.000Z"
}
```

**Error Response**:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Search query is required",
    "timestamp": "2024-01-01T12:00:00.000Z",
    "path": "/api/extract-book",
    "method": "POST"
  }
}
```

**Status Codes**:
- `200 OK` - Book extracted successfully
- `400 Bad Request` - Invalid request parameters
- `429 Too Many Requests` - Rate limit exceeded
- `500 Internal Server Error` - Server error
- `502 Bad Gateway` - External API error

### 3. Agent Card

Get the agent's capabilities and configuration.

**Endpoint**: `GET /.well-known/agent.json`

**Description**: Returns the agent card for A2A discovery.

**Request Parameters**: None

**Response**:

```json
{
  "name": "Public Domain Book Extractor",
  "description": "An A2A-enabled agent that extracts excerpts from public domain books using Project Gutenberg",
  "version": "1.0.0",
  "capabilities": {
    "streaming": true,
    "pushNotifications": false
  },
  "provider": {
    "organization": "A2A Book Agent",
    "url": "https://github.com/seyiFortress/a2a-book-agent"
  },
  "executionUrl": "/a2a/book-extractor-001",
  "defaultInputModes": ["text"],
  "defaultOutputModes": ["text"],
  "skills": [
    {
      "name": "extractBookExcerpt",
      "description": "Searches for a public domain book on Project Gutenberg and returns a short excerpt",
      "inputModes": ["text"],
      "outputModes": ["text"]
    }
  ],
  "extensions": [
    {
      "name": "telex-im-integration",
      "description": "Enhanced integration with Telex.im platform",
      "version": "1.0.0",
      "methods": [
        "message/send",
        "message/stream",
        "tasks/get",
        "tasks/cancel",
        "tasks/setPushNotificationConfig",
        "tasks/getPushNotificationConfig",
        "tasks/resubscribe"
      ]
    }
  ]
}
```

**Status Codes**:
- `200 OK` - Agent card returned successfully

## A2A Protocol Methods

The A2A Book Agent implements the Agent-to-Agent (A2A) protocol for communication with Telex.im and compatible platforms.

### Base A2A Endpoint

```
POST /a2a/book-extractor-001
```

All A2A requests must follow the JSON-RPC 2.0 format:

```json
{
  "jsonrpc": "2.0",
  "method": "method_name",
  "params": { ... },
  "id": "request_id"
}
```

### 1. message/send

Send a message and receive a response.

**Method**: `message/send`

**Parameters**:

```json
{
  "message": {
    "role": "user",
    "parts": [
      {
        "type": "text",
        "text": "Find a book with: query: Pride and Prejudice"
      }
    ]
  },
  "sessionId": "optional_session_id"
}
```

**Parameter Details**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| message | object | Yes | Message object with role and parts |
| message.role | string | Yes | Must be "user" or "assistant" |
| message.parts | array | Yes | Array of message parts |
| message.parts[].type | string | Yes | "text", "file", or "data" |
| message.parts[].text | string | No | Text content for text parts |
| sessionId | string | No | Optional session identifier |

**Response**:

```json
{
  "jsonrpc": "2.0",
  "result": {
    "task": {
      "id": "task_1640995200000_abc123def",
      "status": {
        "state": "completed",
        "timestamp": "2024-01-01T12:00:00.000Z",
        "message": {
          "role": "assistant",
          "parts": [
            {
              "type": "text",
              "text": "📚 **Pride and Prejudice**\n\n*By Jane Austen*\n\nIt is a truth universally acknowledged..."
            }
          ]
        }
      },
      "artifacts": [
        {
          "type": "book_excerpt",
          "name": "Book Excerpt",
          "data": {
            "title": "Pride and Prejudice",
            "authors": "Jane Austen",
            "excerpt": "It is a truth universally acknowledged...",
            "source": "Project Gutenberg"
          },
          "timestamp": "2024-01-01T12:00:00.000Z"
        }
      ],
      "history": [...]
    },
    "message": {
      "role": "assistant",
      "parts": [...]
    },
    "processingTime": 2450
  },
  "id": "request_id"
}
```

### 2. message/stream

Stream a message response in real-time.

**Method**: `message/stream`

**Parameters**: Same as `message/send`

**Response**: Server-Sent Events (SSE) stream

```http
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive

data: {"jsonrpc":"2.0","result":{"task":{...},"status":"started"},"id":"request_id"}

data: {"jsonrpc":"2.0","result":{"taskId":"task_123","status":"searching","message":"Searching for books..."},"id":"request_id"}

data: {"jsonrpc":"2.0","result":{"taskId":"task_123","status":"processing","message":"Processing book content..."},"id":"request_id"}

data: {"jsonrpc":"2.0","result":{"task":{...},"status":"completed"},"id":"request_id"}

data: {"jsonrpc":"2.0","result":{"taskId":"task_123","message":{...},"processingTime":2450},"id":"request_id"}

data: {"jsonrpc":"2.0","result":{"taskId":"task_123","status":"stream_complete"},"id":"request_id"}
```

### 3. tasks/get

Get the status and results of a specific task.

**Method**: `tasks/get`

**Parameters**:

```json
{
  "id": "task_1640995200000_abc123def"
}
```

**Response**:

```json
{
  "jsonrpc": "2.0",
  "result": {
    "id": "task_1640995200000_abc123def",
    "status": {
      "state": "completed",
      "timestamp": "2024-01-01T12:00:00.000Z",
      "message": {
        "role": "assistant",
        "parts": [...]
      }
    },
    "artifacts": [...],
    "history": [...],
    "sessionId": "session_123456",
    "retrievedAt": "2024-01-01T12:05:00.000Z",
    "age": 300000
  },
  "id": "request_id"
}
```

### 4. tasks/cancel

Cancel a running or pending task.

**Method**: `tasks/cancel`

**Parameters**:

```json
{
  "id": "task_1640995200000_abc123def"
}
```

**Response**:

```json
{
  "jsonrpc": "2.0",
  "result": {
    "id": "task_1640995200000_abc123def",
    "status": {
      "state": "canceled",
      "timestamp": "2024-01-01T12:00:00.000Z",
      "message": {
        "role": "assistant",
        "parts": [
          {
            "type": "text",
            "text": "Task was canceled by user request"
          }
        ]
      }
    },
    "artifacts": [],
    "history": [...],
    "canceledAt": "2024-01-01T12:00:00.000Z"
  },
  "id": "request_id"
}
```

### 5. tasks/setPushNotificationConfig

Configure push notifications for a task.

**Method**: `tasks/setPushNotificationConfig`

**Parameters**:

```json
{
  "id": "task_1640995200000_abc123def",
  "pushNotificationConfig": {
    "url": "https://your-webhook-url.com/notify",
    "authentication": {
      "type": "bearer",
      "token": "your_webhook_token"
    }
  }
}
```

**Parameter Details**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| id | string | Yes | Task ID |
| pushNotificationConfig | object | Yes | Push notification configuration |
| pushNotificationConfig.url | string | No | Webhook URL for notifications |
| pushNotificationConfig.authentication | object | No | Authentication configuration |
| pushNotificationConfig.authentication.type | string | No | "bearer" or "basic" |
| pushNotificationConfig.authentication.token | string | No | Token for bearer auth |
| pushNotificationConfig.authentication.username | string | No | Username for basic auth |
| pushNotificationConfig.authentication.password | string | No | Password for basic auth |

**Response**:

```json
{
  "jsonrpc": "2.0",
  "result": {
    "task": {...},
    "pushNotificationConfig": {
      "url": "https://your-webhook-url.com/notify",
      "authentication": {
        "type": "bearer",
        "token": "[REDACTED]"
      }
    },
    "configuredAt": "2024-01-01T12:00:00.000Z"
  },
  "id": "request_id"
}
```

### 6. tasks/getPushNotificationConfig

Get the push notification configuration for a task.

**Method**: `tasks/getPushNotificationConfig`

**Parameters**:

```json
{
  "id": "task_1640995200000_abc123def"
}
```

**Response**:

```json
{
  "jsonrpc": "2.0",
  "result": {
    "taskId": "task_1640995200000_abc123def",
    "pushNotificationConfig": {
      "url": "https://your-webhook-url.com/notify",
      "authentication": {
        "type": "bearer"
      }
    },
    "hasConfig": true,
    "retrievedAt": "2024-01-01T12:00:00.000Z"
  },
  "id": "request_id"
}
```

### 7. tasks/resubscribe

Resubscribe to task updates.

**Method**: `tasks/resubscribe`

**Parameters**:

```json
{
  "id": "task_1640995200000_abc123def"
}
```

**Response**:

```json
{
  "jsonrpc": "2.0",
  "result": {
    "task": {...},
    "resubscribed": true,
    "resubscribedAt": "2024-01-01T12:00:00.000Z",
    "currentState": "completed",
    "message": "Successfully resubscribed to task updates"
  },
  "id": "request_id"
}
```

## Request/Response Formats

### Common Response Fields

All A2A responses follow the JSON-RPC 2.0 format:

```json
{
  "jsonrpc": "2.0",
  "result": { ... },
  "error": { ... },
  "id": "request_id"
}
```

### Task Object Structure

```json
{
  "id": "task_1640995200000_abc123def",
  "status": {
    "state": "working|completed|canceled",
    "timestamp": "2024-01-01T12:00:00.000Z",
    "message": {
      "role": "user|assistant",
      "parts": [...]
    }
  },
  "artifacts": [
    {
      "type": "book_excerpt",
      "name": "Book Excerpt",
      "data": { ... },
      "timestamp": "2024-01-01T12:00:00.000Z"
    }
  ],
  "history": [
    {
      "timestamp": "2024-01-01T12:00:00.000Z",
      "event": "task_created",
      "data": { ... }
    }
  ],
  "sessionId": "session_123456",
  "pushNotificationConfig": { ... }
}
```

### Message Object Structure

```json
{
  "role": "user|assistant",
  "parts": [
    {
      "type": "text|file|data",
      "text": "Text content",
      "file": { ... },
      "data": { ... }
    }
  ]
}
```

## Error Codes

### HTTP Status Codes

| Code | Description |
|------|-------------|
| 200 | OK - Request successful |
| 400 | Bad Request - Invalid request parameters |
| 404 | Not Found - Resource not found |
| 429 | Too Many Requests - Rate limit exceeded |
| 500 | Internal Server Error - Server error |
| 502 | Bad Gateway - External API error |

### A2A Protocol Error Codes

| Code | Description |
|------|-------------|
| -32700 | Parse error - Invalid JSON |
| -32600 | Invalid Request - Request format invalid |
| -32601 | Method not found - Method doesn't exist |
| -32602 | Invalid params - Invalid parameters |
| -32603 | Internal error - Internal server error |
| -32001 | Task not found - Task ID doesn't exist |
| -32002 | Task not cancelable - Task cannot be canceled |

### Error Response Format

```json
{
  "jsonrpc": "2.0",
  "error": {
    "code": -32602,
    "message": "Invalid params: task id is required",
    "data": {
      "field": "id",
      "reason": "required"
    }
  },
  "id": "request_id"
}
```

### Common Error Scenarios

#### Validation Errors

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Search query is required",
    "timestamp": "2024-01-01T12:00:00.000Z",
    "path": "/api/extract-book",
    "method": "POST",
    "details": {
      "field": "searchQuery",
      "reason": "required"
    }
  }
}
```

#### Rate Limiting

```json
{
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Too many requests",
    "timestamp": "2024-01-01T12:00:00.000Z",
    "path": "/api/extract-book",
    "method": "POST",
    "details": {
      "resetTime": 1640995260000,
      "limit": 100,
      "window": 60000
    }
  }
}
```

#### External API Errors

```json
{
  "error": {
    "code": "EXTERNAL_API_ERROR",
    "message": "Gutenberg API is temporarily unavailable",
    "timestamp": "2024-01-01T12:00:00.000Z",
    "path": "/api/extract-book",
    "method": "POST",
    "details": {
      "service": "gutendex",
      "status": 503
    }
  }
}
```

## Rate Limiting

The API implements rate limiting to prevent abuse:

- **Default Limit**: 100 requests per minute per IP address
- **Window**: 60 seconds
- **Headers**: Rate limit information is included in response headers

### Rate Limit Headers

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1640995260000
```

### Rate Limit Response

When rate limit is exceeded:

```json
{
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Too many requests",
    "details": {
      "resetTime": 1640995260000
    }
  }
}
```

## Security

### Input Validation

All inputs are validated and sanitized:

- **Search Queries**: Sanitized for dangerous content
- **Task IDs**: Validated format (alphanumeric with underscores/hyphens)
- **URLs**: Validated format for webhook configurations
- **Emails**: Validated format where applicable

### Security Headers

The following security headers are implemented:

```
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-XSS-Protection: 1; mode=block
Referrer-Policy: strict-origin-when-cross-origin
```

In production:

```
Strict-Transport-Security: max-age=31536000; includeSubDomains
```

### CORS Configuration

- **Development**: Allows all origins
- **Production**: Restricted to configured origins
- **Methods**: GET, POST, PUT, DELETE, OPTIONS
- **Headers**: Content-Type, Authorization, X-Requested-With

### Content Security

- **JSON Validation**: All JSON payloads are validated
- **Size Limits**: Request body limited to 10MB
- **Timeout**: Requests timeout after 30 seconds
- **Injection Prevention**: Input sanitization prevents XSS and injection attacks

## Examples

### Complete Book Extraction Flow

1. **Send Request**:

```bash
curl -X POST http://localhost:4111/a2a/book-extractor-001 \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "message/send",
    "params": {
      "message": {
        "role": "user",
        "parts": [
          {
            "type": "text",
            "text": "Find a book with: query: Moby Dick"
          }
        ]
      }
    },
    "id": "req_001"
  }'
```

2. **Receive Response**:

```json
{
  "jsonrpc": "2.0",
  "result": {
    "task": {
      "id": "task_1640995200000_abc123def",
      "status": {
        "state": "completed",
        "timestamp": "2024-01-01T12:00:00.000Z",
        "message": {
          "role": "assistant",
          "parts": [
            {
              "type": "text",
              "text": "📚 **Moby-Dick; or, The Whale**\n\n*By Herman Melville*\n\nCall me Ishmael. Some years ago—never mind how long precisely—having little or no money in my purse, and nothing particular to interest me on shore, I thought I would sail about a little and see the watery part of the world..."
            }
          ]
        }
      },
      "artifacts": [
        {
          "type": "book_excerpt",
          "name": "Book Excerpt",
          "data": {
            "title": "Moby-Dick; or, The Whale",
            "authors": "Herman Melville",
            "excerpt": "Call me Ishmael. Some years ago—never mind how long precisely—having little or no money in my purse...",
            "source": "Project Gutenberg",
            "downloadCount": 12847,
            "languages": ["en"],
            "subjects": ["Whales", "Sea stories", "Psychological fiction"]
          },
          "timestamp": "2024-01-01T12:00:00.000Z"
        }
      ],
      "history": [
        {
          "timestamp": "2024-01-01T12:00:00.000Z",
          "event": "task_created",
          "data": {
            "searchQuery": "Moby Dick",
            "userAgent": "A2A-Book-Agent/1.0.0"
          }
        },
        {
          "timestamp": "2024-01-01T12:00:02.450Z",
          "event": "task_completed",
          "data": {
            "result": { ... }
          }
        }
      ]
    },
    "message": {
      "role": "assistant",
      "parts": [
        {
          "type": "text",
          "text": "📚 **Moby-Dick; or, The Whale**\n\n*By Herman Melville*\n\nCall me Ishmael..."
        }
      ]
    },
    "processingTime": 2450
  },
  "id": "req_001"
}
```

3. **Check Task Status**:

```bash
curl -X POST http://localhost:4111/a2a/book-extractor-001 \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tasks/get",
    "params": {
      "id": "task_1640995200000_abc123def"
    },
    "id": "req_002"
  }'
```

### Streaming Example

```javascript
const eventSource = new EventSource(
  'http://localhost:4111/a2a/book-extractor-001',
  {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "message/stream",
      params: {
        message: {
          role: "user",
          parts: [
            {
              type: "text",
              text: "Find a book with: query: Romeo and Juliet"
            }
          ]
        }
      },
      id: "req_stream_001"
    })
  }
);

eventSource.onmessage = function(event) {
  const data = JSON.parse(event.data);
  console.log('Stream data:', data);
  
  if (data.result.status === 'stream_complete') {
    eventSource.close();
  }
};
```

---

For more information about the A2A Book Agent, see the [README.md](./README.md) file.