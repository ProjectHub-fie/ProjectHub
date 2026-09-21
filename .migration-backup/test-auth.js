 databas// Simple test script to verify authentication functionality
async function testAuth() {
  const baseUrl = 'http://localhost:5000'; // Fixed to match the server port
  
  console.log('🧪 Testing Authentication Flow\n');
  
  try {
    // Test 1: Health check
    console.log('1. Testing health check endpoint...');
    const healthResponse = await fetch(`${baseUrl}/api/health`);
    const healthData = await healthResponse.json();
    console.log('✅ Health check:', healthData.status);
    console.log('Environment:', healthData.environment);
    
    // Test 2: Debug auth endpoint
    console.log('\n2. Testing debug auth endpoint...');
    const debugResponse = await fetch(`${baseUrl}/api/debug/auth`);
    const debugData = await debugResponse.json();
    console.log('✅ Debug auth info:');
    console.log('Environment:', debugData.environment);
    console.log('Database status:', debugData.database?.status);
    console.log('Cookies:', debugData.cookies);
    
    // Test 3: Registration
    console.log('\n3. Testing user registration...');
    const registerResponse = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        email: 'test@example.com',
        password: 'password123',
        firstName: 'Test',
        lastName: 'User'
      })
    });
    
    const registerData = await registerResponse.json();
    console.log('Registration status:', registerResponse.status);
    console.log('Registration response:', registerData);
    
    if (registerResponse.ok) {
      console.log('✅ Registration successful');
      
      // Test 4: Login
      console.log('\n4. Testing user login...');
      const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          email: 'test@example.com',
          password: 'password123'
        })
      });
      
      const loginData = await loginResponse.json();
      console.log('Login status:', loginResponse.status);
      console.log('Login response:', loginData);
      
      if (loginResponse.ok) {
        console.log('✅ Login successful');
        
        // Test 5: Profile check
        console.log('\n5. Testing profile access...');
        const profileResponse = await fetch(`${baseUrl}/api/auth/me`, {
          credentials: 'include'
        });
        
        const profileData = await profileResponse.json();
        console.log('Profile status:', profileResponse.status);
        console.log('Profile response:', profileData);
        
        if (profileResponse.ok) {
          console.log('✅ Profile access successful');
        } else {
          console.log('❌ Profile access failed');
        }
        
        // Test 6: Logout
        console.log('\n6. Testing logout...');
        const logoutResponse = await fetch(`${baseUrl}/api/auth/logout`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include'
        });
        
        const logoutData = await logoutResponse.json();
        console.log('Logout status:', logoutResponse.status);
        console.log('Logout response:', logoutData);
        
        if (logoutResponse.ok) {
          console.log('✅ Logout successful');
        } else {
          console.log('❌ Logout failed');
        }
      } else {
        console.log('❌ Login failed');
      }
    } else {
      console.log('Registration failed, trying login with existing user...');
      
      // Test login anyway
      console.log('\n4. Testing user login with existing user...');
      const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          email: 'test@example.com',
          password: 'password123'
        })
      });
      
      const loginData = await loginResponse.json();
      console.log('Login status:', loginResponse.status);
      console.log('Login response:', loginData);
      
      if (loginResponse.ok) {
        console.log('✅ Login successful');
      } else {
        console.log('❌ Login failed');
      }
    }
    
  } catch (error) {
    console.error('❌ Test failed with error:', error.message);
  }
}

// Run the test
testAuth();