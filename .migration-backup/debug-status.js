#!/usr/bin/env node

// Debug script to check deployment status
async function debugDeployment() {
  console.log('Debugging deployment status...\n');
  
  try {
    // Check the new deployment URL
    const response = await fetch('https://project-rhw7bf43o-rajroy1313s-projects.vercel.app/');
    console.log(`New deployment URL status: ${response.status}`);
    console.log(`Headers:`, Object.fromEntries(response.headers));
    
    if (response.status === 401) {
      const text = await response.text();
      console.log('Response body (first 500 chars):', text.substring(0, 500));
    }
    
    // Try API endpoint
    const apiResponse = await fetch('https://project-rhw7bf43o-rajroy1313s-projects.vercel.app/api/health');
    console.log(`\nAPI endpoint status: ${apiResponse.status}`);
    
  } catch (error) {
    console.error('Debug failed:', error.message);
  }
}

debugDeployment();