#!/usr/bin/env node

// Debug session management and cookies
async function debugSession() {
  const baseUrl = 'https://project-4iwql7fr5-rajroy1313s-projects.vercel.app';
  
  console.log('🔍 Debugging session management...\n');
  
  // Test login and session handling
  console.log('📋 Test: Login and Session Flow');
  
  // First, let's check what the API expects for session management
  try {
    // Try a simple login without session management first
    const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'testuser@example.com',
        password: 'testpassword123'
      })
    });
    
    console.log(`Login Status: ${loginResponse.status}`);
    console.log(`Login Headers:`, Object.fromEntries(loginResponse.headers));
    
    const loginData = await loginResponse.json();
    console.log(`Login Response:`, loginData);
    
    // Check if we get any session-related headers
    const setCookie = loginResponse.headers.get('set-cookie');
    console.log(`Set-Cookie header: ${setCookie || 'None found'}`);
    
    // Try auth check immediately after
    const authResponse = await fetch(`${baseUrl}/api/auth/me`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });
    
    console.log(`\nAuth Status: ${authResponse.status}`);
    console.log(`Auth Headers:`, Object.fromEntries(authResponse.headers));
    
    const authData = await authResponse.json();
    console.log(`Auth Response:`, authData);
    
  } catch (error) {
    console.log(`Error: ${error.message}`);
  }
  
  console.log('\n🔧 Debugging complete!');
}

// Run the debug session
debugSession();