// Simple test script to verify API functionality
async function testAPI() {
  const baseUrl = process.argv[2] || 'http://localhost:5000';
  
  console.log(`🧪 Testing API endpoints on ${baseUrl}\n`);
  
  const endpoints = [
    { path: '/api/health', name: 'Health Check' },
    { path: '/api/debug/env', name: 'Environment Debug' },
    { path: '/api/debug/auth', name: 'Auth Debug' }
  ];
  
  for (const endpoint of endpoints) {
    try {
      console.log(`Testing ${endpoint.name} (${endpoint.path})...`);
      const response = await fetch(`${baseUrl}${endpoint.path}`);
      const data = await response.json();
      
      console.log(`✅ Status: ${response.status}`);
      console.log(`✅ Response:`, JSON.stringify(data, null, 2));
      console.log('');
    } catch (error) {
      console.log(`❌ Error testing ${endpoint.name}:`, error.message);
      console.log('');
    }
  }
}

testAPI();