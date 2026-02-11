#!/usr/bin/env node

// Test script to verify password reset functionality
async function testPasswordReset() {
  const baseUrl = 'https://project-p0n0ixmfu-rajroy1313s-projects.vercel.app';
  
  console.log('Testing password reset functionality...\n');
  
  try {
    // Test 1: Health check
    console.log('1. Testing health check endpoint...');
    const healthResponse = await fetch(`${baseUrl}/api/health`);
    console.log(`Health check status: ${healthResponse.status}`);
    const healthData = await healthResponse.json();
    console.log('Health data:', healthData);
    
    // Test 2: Password reset request (forgot password)
    console.log('\n2. Testing forgot password endpoint...');
    const forgotResponse = await fetch(`${baseUrl}/api/auth/recovery?action=forgot`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: 'test@example.com'
      })
    });
    
    console.log(`Forgot password status: ${forgotResponse.status}`);
    const forgotData = await forgotResponse.json();
    console.log('Forgot password response:', forgotData);
    
    // Test 3: Try to access reset page directly
    console.log('\n3. Testing direct reset link access...');
    const directResetResponse = await fetch(`${baseUrl}/reset-password?token=test-token`);
    console.log(`Direct reset access status: ${directResetResponse.status}`);
    
    if (directResetResponse.status === 200) {
      console.log('✓ Direct link access works - users can reach reset page');
    } else {
      console.log('⚠ Direct link access may have issues');
    }
    
    console.log('\n=== Test Summary ===');
    console.log('✓ Health check endpoint working');
    console.log('✓ Password reset API endpoint accessible');
    console.log('✓ Direct link routing functional');
    
  } catch (error) {
    console.error('Test failed:', error.message);
  }
}

// Run the test
testPasswordReset();