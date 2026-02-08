// Test script to verify API imports are working correctly
console.log('Testing API imports...');

try {
  // Test importing the main API handler
  const apiHandler = await import('./api/index.js');
  console.log('✅ Main API handler imported successfully');
  
  // Test importing individual handlers
  const authHandler = await import('./api/handlers/auth/auth-main.js');
  console.log('✅ Auth handler imported successfully');
  
  const profileHandler = await import('./api/handlers/auth/profile-main.js');
  console.log('✅ Profile handler imported successfully');
  
  const recoveryHandler = await import('./api/handlers/auth/recovery-main.js');
  console.log('✅ Recovery handler imported successfully');
  
  const contactHandler = await import('./api/handlers/contact-main.js');
  console.log('✅ Contact handler imported successfully');
  
  const projectRequestsHandler = await import('./api/handlers/project-requests-main.js');
  console.log('✅ Project requests handler imported successfully');
  
  const projectsHandler = await import('./api/handlers/projects-main.js');
  console.log('✅ Projects handler imported successfully');
  
  console.log('\n🎉 All API imports are working correctly!');
  
} catch (error) {
  console.error('❌ Import error:', error.message);
  console.error('Stack:', error.stack);
}