#!/usr/bin/env node

import { execSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Get absolute paths
const projectRoot = resolve(__dirname, '..');
const clientDir = resolve(projectRoot, 'client');
const indexPath = resolve(clientDir, 'index.html');

console.log('Vercel Build Script Starting...');
console.log('Project Root:', projectRoot);
console.log('Client Directory:', clientDir);
console.log('Index Path:', indexPath);

// Verify the index.html file exists
try {
  const fs = await import('fs');
  if (!fs.existsSync(indexPath)) {
    throw new Error(`index.html not found at ${indexPath}`);
  }
  console.log('✓ index.html file verified');
} catch (error) {
  console.error('✗ File verification failed:', error.message);
  process.exit(1);
}

try {
  // Change to project root and run Vite build with explicit config
  console.log('Running Vite build...');
  execSync(
    `vite build --config ${resolve(projectRoot, 'vite.config.ts')} --base /`,
    { 
      cwd: projectRoot,
      stdio: 'inherit',
      env: {
        ...process.env,
        NODE_ENV: 'production'
      }
    }
  );
  
  console.log('✓ Client build completed');
  
  // Build server
  console.log('Building server...');
  execSync(
    'dotenv -e .env -- esbuild server/index.ts --platform=node --packages=external --bundle --format=esm --outdir=dist --alias:@shared=./shared',
    { 
      cwd: projectRoot,
      stdio: 'inherit'
    }
  );
  
  console.log('✓ Server build completed');
  console.log('Build process finished successfully!');
  
} catch (error) {
  console.error('Build failed:', error.message);
  process.exit(1);
}