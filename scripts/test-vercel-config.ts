import dotenv from 'dotenv';
dotenv.config();

console.log('=== Vercel Configuration Test ===');
console.log('CLIENT_ORIGIN:', process.env.CLIENT_ORIGIN || 'Not set');
console.log('VERCEL_URL:', process.env.VERCEL_URL || 'Not set');
console.log('NODE_ENV:', process.env.NODE_ENV || 'Not set');
console.log('DATABASE_URL exists:', !!process.env.DATABASE_URL);
console.log('SESSION_SECRET exists:', !!process.env.SESSION_SECRET);

// Test the default URL
const defaultUrl = process.env.CLIENT_ORIGIN || 
                  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '') ||
                  'https://pbad.vercel.app';

console.log('\nResolved Origin URL:', defaultUrl);
console.log('Is production-like URL:', defaultUrl.includes('vercel.app'));

if (defaultUrl === 'https://pbad.vercel.app') {
  console.log('✅ Using default Vercel URL as expected');
} else {
  console.log('ℹ️  Using custom URL configuration');
}