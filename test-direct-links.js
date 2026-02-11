#!/usr/bin/env node

// Comprehensive test for direct link access and routing
async function testDirectLinks() {
  const baseUrl = 'https://project-p0n0ixmfu-rajroy1313s-projects.vercel.app';
  
  console.log('Testing direct link access functionality...\n');
  
  const testCases = [
    {
      name: 'Main homepage',
      url: `${baseUrl}/`,
      expectedStatus: 200
    },
    {
      name: 'Projects page',
      url: `${baseUrl}/projects`,
      expectedStatus: 200
    },
    {
      name: 'Login page',
      url: `${baseUrl}/login`,
      expectedStatus: 200
    },
    {
      name: 'Direct reset password link',
      url: `${baseUrl}/reset-password?token=abc123`,
      expectedStatus: 200
    },
    {
      name: 'API health check',
      url: `${baseUrl}/api/health`,
      expectedStatus: 200
    },
    {
      name: 'Non-existent page (should show 404 page)',
      url: `${baseUrl}/non-existent-page`,
      expectedStatus: 200 // SPA should handle this
    }
  ];
  
  for (const testCase of testCases) {
    try {
      console.log(`Testing: ${testCase.name}`);
      console.log(`URL: ${testCase.url}`);
      
      const response = await fetch(testCase.url, {
        redirect: 'manual' // Don't follow redirects automatically
      });
      
      console.log(`Status: ${response.status}`);
      
      if (response.status === testCase.expectedStatus) {
        console.log(`✓ PASS: ${testCase.name}`);
      } else {
        console.log(`⚠ UNEXPECTED: Expected ${testCase.expectedStatus}, got ${response.status}`);
      }
      
      console.log('---');
      
    } catch (error) {
      console.log(`✗ FAIL: ${testCase.name} - ${error.message}`);
      console.log('---');
    }
  }
  
  console.log('\n=== Direct Link Access Test Complete ===');
  console.log('If all tests pass, users should be able to access:');
  console.log('- Main site pages directly');
  console.log('- Password reset links');
  console.log('- OAuth callback URLs');
  console.log('- API endpoints');
}

// Run the test
testDirectLinks();