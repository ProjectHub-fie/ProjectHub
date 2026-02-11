#!/usr/bin/env node

import { spawn } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

console.log('🔍 Verifying Vercel deployment readiness...\n');

// Check required files
const requiredFiles = [
  'vercel.json',
  'package.json',
  'vite.config.js',
  'api/index.js'
];

console.log('📋 Checking required files:');
let allFilesExist = true;
for (const file of requiredFiles) {
  const exists = existsSync(join(process.cwd(), file));
  console.log(`  ${exists ? '✅' : '❌'} ${file}: ${exists ? 'Found' : 'Missing'}`);
  if (!exists) allFilesExist = false;
}

console.log('\n📦 Checking package.json scripts:');
try {
  const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
  const requiredScripts = ['build', 'vercel-build'];
  for (const script of requiredScripts) {
    const exists = !!packageJson.scripts?.[script];
    console.log(`  ${exists ? '✅' : '❌'} ${script}: ${exists ? 'Found' : 'Missing'}`);
    if (!exists) allFilesExist = false;
  }
} catch (error) {
  console.log('  ❌ package.json: Invalid JSON');
  allFilesExist = false;
}

console.log('\n🔧 Checking vercel.json configuration:');
try {
  const vercelJson = JSON.parse(readFileSync('vercel.json', 'utf8'));
  const checks = [
    { name: 'buildCommand', exists: !!vercelJson.buildCommand },
    { name: 'outputDirectory', exists: !!vercelJson.outputDirectory },
    { name: 'rewrites', exists: Array.isArray(vercelJson.rewrites) }
  ];
  
  for (const check of checks) {
    console.log(`  ${check.exists ? '✅' : '❌'} ${check.name}: ${check.exists ? 'Configured' : 'Missing'}`);
    if (!check.exists) allFilesExist = false;
  }
} catch (error) {
  console.log('  ❌ vercel.json: Invalid JSON');
  allFilesExist = false;
}

console.log('\n🚫 Checking .vercelignore:');
const vercelIgnoreExists = existsSync('.vercelignore');
console.log(`  ${vercelIgnoreExists ? '✅' : '⚠️'} .vercelignore: ${vercelIgnoreExists ? 'Found' : 'Not found (optional)'}`);

console.log('\n📊 Summary:');
if (allFilesExist) {
  console.log('  ✅ All required files and configurations are present');
  console.log('  🚀 Ready for Vercel deployment!');
  console.log('\n📝 Next steps:');
  console.log('  1. Run: vercel deploy --prod');
  console.log('  2. Set required environment variables in Vercel dashboard:');
  console.log('     - DATABASE_URL');
  console.log('     - SESSION_SECRET');
  console.log('     - NEXT_PUBLIC_APP_URL');
  process.exit(0);
} else {
  console.log('  ❌ Missing required files or configurations');
  console.log('  🔧 Please fix the issues above before deploying');
  process.exit(1);
}