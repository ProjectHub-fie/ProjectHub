t seems #!/usr/bin/env node

// Comprehensive API test script
async function testAllAPIs() {
  const baseUrl = 'https://project-ma2sdqr5w-rajroy1313s-projects.vercel.app';
  
  console.log('🧪 Testing all API endpoints...\n');
  
  const tests = [
    {
      name: 'Health Check',
      method: 'GET',
      url: '/api/health',
      expectedStatus: 200
    },
    {
      name: 'Login',
      method: 'POST',
      url: '/api/auth/login',
      body: { email: 'test@example.com', password: 'password' },
      expectedStatus: 200
    },
    {
      name: 'Register',
      method: 'POST',
      url: '/api/auth/register',
      body: { 
        email: 'newuser@example.com', 
        password: 'password123',
        firstName: 'New',
        lastName: 'User'
      },
      expectedStatus: 201
    },
    {
      name: 'Contact Form',
      method: 'POST',
      url: '/api/contact',
      body: {
        name: 'Test User',
        email: 'test@example.com',
        subject: 'Test Subject',
        message: 'Test message content',
        captchaToken: 'test-captcha-token'
      },
      expectedStatus: 200
    },
    {
      name: 'Project Interaction',
      method: 'POST',
      url: '/api/projects/test-project/interactions',
      body: { action: 'view', userId: 'test-user' },
      expectedStatus: 200
    },
    {
      name: 'Password Recovery - Forgot',
      method: 'POST',
      url: '/api/auth/recovery?action=forgot',
      body: { email: 'test@example.com' },
      expectedStatus: 200
    },
    {
      name: 'Password Recovery - Reset',
      method: 'POST',
      url: '/api/auth/recovery?action=reset',
      body: { token: 'test-token', newPassword: 'newpassword123' },
      expectedStatus: 200
    },
    {
      name: 'Auth Me (without token)',
      method: 'GET',
      url: '/api/auth/me',
      expectedStatus: 401
    },
    {
      name: 'Non-existent endpoint',
      method: 'GET',
      url: '/api/nonexistent',
      expectedStatus: 404
    }
  ];

  let passedTests = 0;
  let failedTests = 0;

  for (const test of tests) {
    try {
      console.log(`📋 Testing: ${test.name}`);
      
      const options = {
        method: test.method,
        headers: { 'Content-Type': 'application/json' }
      };
      
      if (test.body) {
        options.body = JSON.stringify(test.body);
      }
      
      // Add timeout to prevent hanging
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      
      const response = await fetch(baseUrl + test.url, {
        ...options,
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      const status = response.status;
      
      console.log(`   Status: ${status} (expected: ${test.expectedStatus})`);
      
      if (status === test.expectedStatus) {
        console.log('   ✅ PASS');
        passedTests++;
        
        // Show response data for successful tests
        if (status < 400) {
          try {
            const data = await response.json();
            console.log(`   Response: ${JSON.stringify(data).substring(0, 100)}...`);
          } catch (e) {
            // Skip if response isn't JSON
          }
        }
      } else {
        console.log('   ❌ FAIL');
        console.log(`   Response: ${await response.text()}`);
        failedTests++;
      }
      
    } catch (error) {
      console.log(`   ❌ ERROR: ${error.message}`);
      failedTests++;
    }
    
    console.log('');
  }
  
  console.log('📊 Test Results:');
  console.log(`   ✅ Passed: ${passedTests}`);
  console.log(`   ❌ Failed: ${failedTests}`);
  console.log(`   📈 Success Rate: ${Math.round((passedTests / tests.length) * 100)}%`);
  
  if (failedTests === 0) {
    console.log('\n🎉 All API tests passed! Your application should now work properly.');
    console.log('\n🚀 Your ProjectHub is now fully functional with:');
    console.log('   - ✅ Authentication (login/register/logout)');
    console.log('   - ✅ Password recovery system');
    console.log('   - ✅ Contact form submissions');
    console.log('   - ✅ Project interactions tracking');
    console.log('   - ✅ Health monitoring endpoint');
    console.log('\n🔗 Live URL: https://projecthub.inc');
  } else {
    console.log('\n⚠️  Some tests failed. Check the implementation above.');
  }
}

// Run the tests
testAllAPIs();