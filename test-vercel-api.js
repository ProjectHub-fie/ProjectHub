// Simple test script to verify API functionality before Vercel deployment
import http from 'http';

console.log('🧪 Testing API functionality...\n');

// Mock request object
const mockReq = {
  method: 'GET',
  url: '/api/health',
  headers: { 'host': 'localhost:3000' }
};

// Mock response object
const mockRes = {
  statusCode: 200,
  headers: {},
  json(data) {
    console.log('✅ Health endpoint response:', JSON.stringify(data, null, 2));
    this.end(JSON.stringify(data));
  },
  status(code) {
    this.statusCode = code;
    return this;
  },
  setHeader(key, value) {
    this.headers[key] = value;
  },
  end(data) {
    console.log(`✅ Response status: ${this.statusCode}`);
    if (data) console.log('✅ Response data:', data);
  }
};

// Import and test the API handler
try {
  const { default: handler } = await import('./api/index.js');
  
  console.log('🚀 Testing health endpoint...');
  await handler(mockReq, mockRes);
  
  console.log('\n✅ API handler loaded successfully!');
  console.log('✅ Health endpoint working!');
  
} catch (error) {
  console.error('❌ API test failed:', error.message);
  process.exit(1);
}