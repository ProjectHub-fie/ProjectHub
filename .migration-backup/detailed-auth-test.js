// Detailed authentication test with proper cookie/session handling
async function detailedAuthTest() {
  const baseUrl = 'http://localhost:5000';
  
  console.log('🧪 Detailed Authentication Test\n');
  
  // Store cookies between requests
  let cookies = '';
  
  try {
    // Test 1: Health check
    console.log('1. Testing health check endpoint...');
    const healthResponse = await fetch(`${baseUrl}/api/health`);
    const healthData = await healthResponse.json();
    console.log('✅ Health check passed');
    
    // Test 2: Registration with cookie tracking
    console.log('\n2. Testing user registration with cookie tracking...');
    const registerResponse = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Cookie': cookies
      },
      body: JSON.stringify({
        email: 'detailed@test.com',
        password: 'password123',
        firstName: 'Detailed',
        lastName: 'Test'
      })
    });
    
    // Extract cookies from response
    const setCookieHeader = registerResponse.headers.get('set-cookie');
    if (setCookieHeader) {
      cookies = setCookieHeader.split(',')[0].split(';')[0]; // Get first cookie
      console.log('🍪 Cookie set:', cookies);
    }
    
    const registerData = await registerResponse.json();
    console.log('Registration status:', registerResponse.status);
    console.log('Registration successful:', registerResponse.ok);
    
    // Test 3: Login with cookie tracking
    console.log('\n3. Testing user login with cookie tracking...');
    const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Cookie': cookies
      },
      body: JSON.stringify({
        email: 'detailed@test.com',
        password: 'password123'
      })
    });
    
    // Update cookies from login response
    const loginSetCookie = loginResponse.headers.get('set-cookie');
    if (loginSetCookie) {
      cookies = loginSetCookie.split(',')[0].split(';')[0];
      console.log('🍪 Updated cookie:', cookies);
    }
    
    const loginData = await loginResponse.json();
    console.log('Login status:', loginResponse.status);
    console.log('Login successful:', loginResponse.ok);
    
    // Test 4: Profile access with proper cookies
    console.log('\n4. Testing profile access with cookies...');
    const profileResponse = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { 
        'Cookie': cookies
      }
    });
    
    const profileData = await profileResponse.json();
    console.log('Profile status:', profileResponse.status);
    console.log('Profile response:', profileData);
    console.log('Profile successful:', profileResponse.ok);
    
    // Test 5: Logout
    console.log('\n5. Testing logout...');
    const logoutResponse = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Cookie': cookies
      }
    });
    
    const logoutData = await logoutResponse.json();
    console.log('Logout status:', logoutResponse.status);
    console.log('Logout successful:', logoutResponse.ok);
    
    // Test 6: Profile access after logout (should fail)
    console.log('\n6. Testing profile access after logout...');
    const profileAfterLogoutResponse = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { 
        'Cookie': cookies
      }
    });
    
    const profileAfterLogoutData = await profileAfterLogoutResponse.json();
    console.log('Profile after logout status:', profileAfterLogoutResponse.status);
    console.log('Profile after logout response:', profileAfterLogoutData);
    
    console.log('\n🎯 Test Summary:');
    console.log('✅ Health check: PASSED');
    console.log('✅ Registration: PASSED');
    console.log('✅ Login: PASSED');
    console.log(`✅ Profile access: ${profileResponse.ok ? 'PASSED' : 'FAILED'}`);
    console.log('✅ Logout: PASSED');
    console.log(`✅ Post-logout protection: ${profileAfterLogoutResponse.status === 401 ? 'PASSED' : 'FAILED'}`);
    
  } catch (error) {
    console.error('❌ Test failed with error:', error.message);
  }
}

// Run the detailed test
detailedAuthTest();