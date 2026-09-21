#!/usr/bin/env node

// Test the login and redirection flow
async function testLoginFlow() {
  const baseUrl = 'https://project-4iwql7fr5-rajroy1313s-projects.vercel.app';
  
  console.log('🧪 Testing login and redirection flow...\n');
  
  // Test 1: Attempt login
  console.log('📋 Test 1: User Login');
  try {
    const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'testuser@example.com',
        password: 'testpassword123'
      })
    });
    
    const loginData = await loginResponse.json();
    console.log(`   Status: ${loginResponse.status}`);
    
    if (loginResponse.status === 200) {
      console.log('   ✅ Login successful');
      console.log(`   User ID: ${loginData.user.id}`);
      console.log(`   Email: ${loginData.user.email}`);
      console.log(`   Session Token: ${loginData.sessionToken ? 'Present' : 'Missing'}`);
    } else {
      console.log('   ❌ Login failed');
      console.log(`   Error: ${loginData.message}`);
      return;
    }
  } catch (error) {
    console.log(`   ❌ Login error: ${error.message}`);
    return;
  }
  
  console.log('');
  
  // Test 2: Check auth status endpoint
  console.log('📋 Test 2: Auth Status Check');
  try {
    const authResponse = await fetch(`${baseUrl}/api/auth/me`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });
    
    const authData = await authResponse.json();
    console.log(`   Status: ${authResponse.status}`);
    
    if (authResponse.status === 200) {
      console.log('   ✅ Auth check successful');
      console.log(`   Authenticated user: ${authData.user ? 'Yes' : 'No'}`);
      if (authData.user) {
        console.log(`   User email: ${authData.user.email}`);
      }
    } else {
      console.log('   ❌ Auth check failed');
      console.log(`   Error: ${authData.message}`);
    }
  } catch (error) {
    console.log(`   ❌ Auth check error: ${error.message}`);
  }
  
  console.log('\n🎯 Login flow test completed!');
  console.log('\nNext steps to debug frontend redirection:');
  console.log('1. Check browser console for authentication events');
  console.log('2. Verify localStorage contains user data after login');
  console.log('3. Confirm the auth-update event is being dispatched');
  console.log('4. Check if the useEffect in LoginPage is triggered');
}

// Run the test
testLoginFlow();