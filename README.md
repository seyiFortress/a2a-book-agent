# A2A Book Agent

A powerful A2A-enabled Public Domain Book Extractor that demonstrates the seamless integration of Mastra's agent framework with Telex's communication protocol. This agent searches for and extracts excerpts from public domain books available through Project Gutenberg.

## 🌟 Features

- **📚 Book Search & Extraction**: Search for public domain books by title, author, or keyword
- **🔗 A2A Protocol Support**: Full compliance with Agent-to-Agent (A2A) communication protocol
- **🌊 Streaming Responses**: Real-time streaming of book extraction progress
- **🔒 Security First**: Comprehensive input validation and sanitization
- **⚡ Rate Limiting**: Built-in protection against API abuse
- **🔄 Retry Logic**: Automatic retry with exponential backoff for external API calls
- **📊 Health Monitoring**: Built-in health check endpoints
- **🛡️ Error Handling**: Comprehensive error handling with detailed error codes
- **🔧 Configurable**: Flexible configuration through environment variables

## 🏗️ Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Telex.im     │    │   A2A Book      │    │  Project        │
│   Platform     │◄──►│   Agent         │◄──►│  Gutenberg      │
│                 │    │                 │    │  API           │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                              │
                              ▼
                       ┌──────────────────┐
                       │   Mastra        │
                       │   Framework     │
                       └──────────────────┘
```

### Core Components

- **Server**: Express.js-based HTTP server with security middleware
- **Book Agent**: Mastra-powered agent with book extraction capabilities
- **Telex Integration**: A2A protocol handler for Telex.im communication
- **Validation Layer**: Comprehensive input validation and sanitization
- **Error Handling**: Centralized error handling with detailed responses

## 📋 Prerequisites

- **Node.js**: Version 18.0 or higher
- **npm**: Version 8.0 or higher
- **OpenAI API Key**: Required for the agent's language model (optional for local development)

## 🚀 Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/seyiFortress/a2a-book-agent.git
   cd a2a-book-agent
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

4. **Start the server**
   ```bash
   npm start
   ```

The server will start on `http://localhost:4111` by default.

## ⚙️ Configuration

Create a `.env` file in the project root with the following variables:

```env
# Server Configuration
NODE_ENV=development
PORT=4111
HOST=localhost

# OpenAI Configuration (optional)
OPENAI_API_KEY=your_openai_api_key_here

# Rate Limiting
RATE_LIMIT_MAX=100
RATE_LIMIT_WINDOW_MS=60000

# CORS Configuration (production only)
ALLOWED_ORIGINS=https://telex.im,https://yourdomain.com
```

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NODE_ENV` | Yes | - | Environment (development/production/test) |
| `PORT` | No | 4111 | Server port (1-65535) |
| `HOST` | No | localhost | Server host |
| `OPENAI_API_KEY` | No | - | OpenAI API key for language model |
| `RATE_LIMIT_MAX` | No | 100 | Max requests per window |
| `RATE_LIMIT_WINDOW_MS` | No | 60000 | Rate limit window in milliseconds |
| `ALLOWED_ORIGINS` | No | - | Comma-separated list of allowed origins |

## 📖 Usage

### Local API Usage

#### Simple Book Extraction

```bash
curl -X POST http://localhost:4111/api/extract-book \
  -H "Content-Type: application/json" \
  -d '{"searchQuery": "Sherlock Holmes"}'
```

#### Response Example

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

### Health Check

```bash
curl http://localhost:4111/health
```

### Agent Card

```bash
curl http://localhost:4111/.well-known/agent.json
```

## 🔌 Telex.im Integration

The A2A Book Agent is designed to work seamlessly with the Telex.im platform through the A2A protocol.

### A2A Endpoint

```
POST http://localhost:4111/a2a/book-extractor-001
```

### Supported A2A Methods

- `message/send` - Send a message and get a response
- `message/stream` - Stream responses in real-time
- `tasks/get` - Get task status and results
- `tasks/cancel` - Cancel a running task
- `tasks/setPushNotificationConfig` - Configure push notifications
- `tasks/getPushNotificationConfig` - Get push notification configuration
- `tasks/resubscribe` - Resubscribe to task updates

### Example A2A Request

```json
{
  "jsonrpc": "2.0",
  "method": "message/send",
  "params": {
    "message": {
      "role": "user",
      "parts": [
        {
          "type": "text",
          "text": "Find a book with: query: Pride and Prejudice"
        }
      ]
    },
    "sessionId": "session_123456"
  },
  "id": "req_001"
}
```

### Example A2A Response

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
              "text": "📚 **Pride and Prejudice**\n\n*By Jane Austen*\n\nIt is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife..."
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
  "id": "req_001"
}
```

## 🛠️ Development

### Project Structure

```
a2a-book-agent/
├── src/
│   ├── server.ts              # Main Express server
│   ├── bookAgent.ts           # Mastra agent implementation
│   ├── bookWorkflow.ts        # Workflow definition
│   ├── telexIntegration.ts    # A2A protocol handler
│   ├── validation.ts          # Validation and error handling
│   ├── asyncHandler.ts        # Async utilities
│   └── types.ts               # TypeScript type definitions
├── .env                       # Environment variables
├── package.json               # Dependencies and scripts
├── tsconfig.json              # TypeScript configuration
├── telex-workflow.json        # Telex workflow definition
└── README.md                  # This file
```

### Running in Development

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Run with custom port
PORT=3000 npm start

# Run in production mode
NODE_ENV=production npm start
```

### Code Style

The project follows these conventions:

- **TypeScript**: Strict type checking enabled
- **ESLint**: Code linting with recommended rules
- **Prettier**: Code formatting with consistent style
- **Zod**: Schema validation for all inputs
- **Error Handling**: Comprehensive error handling with custom error classes

### Testing

```bash
# Run tests
npm test

# Run tests with coverage
npm run test:coverage

# Run tests in watch mode
npm run test:watch
```

## 🔧 API Documentation

For detailed API documentation, including all endpoints, request/response formats, and error codes, see [API.md](./API.md).

## 🐛 Troubleshooting

### Common Issues

#### 1. Server Won't Start

**Problem**: Server fails to start with environment validation error

**Solution**: 
- Ensure all required environment variables are set
- Check that PORT is a valid number between 1-65535
- Verify NODE_ENV is one of: development, production, test

#### 2. Book Extraction Fails

**Problem**: API returns error when searching for books

**Solution**:
- Check internet connection
- Verify Project Gutenberg API is accessible
- Review search query format and length (max 200 characters)
- Check rate limiting settings

#### 3. A2A Protocol Errors

**Problem**: Telex.im integration returns protocol errors

**Solution**:
- Verify request follows JSON-RPC 2.0 format
- Check method name is supported
- Ensure required parameters are provided
- Review agent card configuration

#### 4. Memory Issues

**Problem**: Server becomes slow or crashes under load

**Solution**:
- Adjust rate limiting settings
- Monitor memory usage with `/health` endpoint
- Consider implementing external caching
- Review task cleanup policies

### Debug Mode

Enable debug logging by setting:

```env
NODE_ENV=development
DEBUG=a2a-book-agent:*
```

### Health Monitoring

Monitor the agent's health:

```bash
# Check health status
curl http://localhost:4111/health

# Monitor memory usage
curl http://localhost:4111/health | jq '.memory'
```

## 📄 License

This project is licensed under the ISC License - see the [LICENSE](LICENSE) file for details.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request. For major changes, please open an issue first to discuss what you would like to change.

### Development Process

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Code Review Guidelines

- Ensure all tests pass
- Follow the existing code style
- Update documentation as needed
- Include error handling for new features
- Add type definitions for new interfaces

## 📞 Support

If you encounter any issues or have questions:

- Create an issue on [GitHub Issues](https://github.com/seyiFortress/a2a-book-agent/issues)
- Check the [Troubleshooting](#-troubleshooting) section
- Review the [API Documentation](./API.md)

## 🙏 Acknowledgments

- [Mastra](https://mastra.ai/) - Agent framework
- [Telex.im](https://telex.im/) - A2A protocol implementation
- [Project Gutenberg](https://www.gutenberg.org/) - Public domain books API
- [Express.js](https://expressjs.com/) - Web framework
- [Zod](https://zod.dev/) - Schema validation

---

**Built with ❤️ by Seyi Fortress**
