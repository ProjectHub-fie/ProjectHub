#!/usr/bin/env node

import { spawn } from 'child_process';
import { cpSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log('Starting Vercel build process...');

// Ensure dist directory exists
const distDir = join(__dirname, '../dist');
if (!existsSync(distDir)) {
  mkdirSync(distDir, { recursive: true });
}

// Copy shared files needed for API functions
const sharedSrc = join(__dirname, '../shared');
const sharedDest = join(distDir, 'shared');
if (existsSync(sharedSrc)) {
  cpSync(sharedSrc, sharedDest, { recursive: true });
  console.log('Copied shared directory to dist/shared');
}

// Copy API files needed for functions
const apiSrc = join(__dirname, '../api');
const apiDest = join(distDir, 'api');
if (existsSync(apiSrc)) {
  cpSync(apiSrc, apiDest, { recursive: true });
  console.log('Copied API directory to dist/api');
}

// Copy drizzle schema
const drizzleSrc = join(__dirname, '../drizzle');
const drizzleDest = join(distDir, 'drizzle');
if (existsSync(drizzleSrc)) {
  cpSync(drizzleSrc, drizzleDest, { recursive: true });
  console.log('Copied drizzle directory to dist/drizzle');
}

console.log('Vercel build preparation completed');