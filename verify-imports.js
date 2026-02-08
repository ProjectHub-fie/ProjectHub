// Simple verification script to test API module imports
console.log('🔍 Verifying API module imports...\n');

async function verifyImports() {
  const modules = [
    './api/index.js',
    './api/handlers/auth/auth-main.js',
    './api/handlers/auth/profile-main.js',
    './api/handlers/auth/recovery-main.js',
    './api/handlers/contact-main.js',
    './api/handlers/project-requests-main.js',
    './api/handlers/projects-main.js'
  ];

  let successCount = 0;
  let errorCount = 0;

  for (const modulePath of modules) {
    try {
      await import(modulePath);
      console.log(`✅ ${modulePath} - OK`);
      successCount++;
    } catch (error) {
      console.log(`❌ ${modulePath} - ERROR: ${error.message}`);
      errorCount++;
    }
  }

  console.log(`\n📊 Results: ${successCount} successful, ${errorCount} failed`);
  
  if (errorCount === 0) {
    console.log('🎉 All modules imported successfully!');
    process.exit(0);
  } else {
    console.log('⚠️  Some modules failed to import');
    process.exit(1);
  }
}

verifyImports();