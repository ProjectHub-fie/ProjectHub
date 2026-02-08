# Vercel Authentication Troubleshooting Guide

## Current API Structure

Due to Vercel's 12 serverless function limit, all API endpoints are consolidated in `/api/index.js` with the following routes:

- `/api/health` - Basic health check
- `/api/debug/env` - Environment variable debugging  
- `/api/debug/auth` - Authentication system debugging
- `/api/debug/create-test-user` - Create test user (development only)
- `/api/auth/*` - Authentication endpoints (login, register, logout, etc.)
- `/api/projects/*` - Project-related endpoints
- `/api/contact` - Contact form endpoint
- `/api/project-requests` - Project requests endpoint

## Framework Information

This project uses:
- **Frontend**: React 18 + TypeScript + Vite
- **Backend**: Node.js + Express.js (no Next.js)
- **Database**: PostgreSQL with Drizzle ORM
- **Deployment**: Vercel (serverless functions)

## Common Authentication Issues and Solutions

### 1. Login Returns 401 Unauthorized

**Symptoms**: Login attempts fail with "Invalid email or password" even with correct credentials

**Debug Steps**:
1. Check Vercel logs for database connection errors
2. Verify `DATABASE_URL` environment variable is correctly set
3. Test database connectivity using the debug endpoint:
   ```
   GET /api/debug/auth
   ```
4. Create a test user using the debug endpoint:
   ```
   POST /api/debug/create-test-user
   ```

**Solutions**:
- Ensure PostgreSQL database is accessible from Vercel
- Verify database credentials are correct
- Check if SSL is required (`sslmode=require`)
- Confirm the users table exists and has the correct schema

### 2. Sessions Not Persisting

**Symptoms**: Users get logged out immediately after login, or sessions don't persist between page refreshes

**Debug Steps**:
1. Check browser developer tools → Application → Cookies
2. Verify `connect.sid` cookie is being set with correct attributes
3. Check if cookies are being blocked by browser extensions
4. Test with different browsers/incognito mode

**Solutions**:
- Ensure `NEXT_PUBLIC_APP_URL` matches your Vercel domain exactly
- Verify cookie settings in authentication handlers
- Check that your domain allows third-party cookies if needed

### 3. CORS Errors During Authentication

**Symptoms**: Browser console shows CORS errors when making authentication requests

**Debug Steps**:
1. Check browser console for specific CORS error messages
2. Verify `NEXT_PUBLIC_APP_URL` environment variable
3. Check if the origin matches allowed origins in API handlers

**Solutions**:
- Ensure `NEXT_PUBLIC_APP_URL` is set to your actual Vercel domain
- Verify CORS headers in API handlers
- Make sure frontend requests include `credentials: 'include'`

### 4. Database Connection Failures

**Symptoms**: Authentication fails with database-related errors

**Debug Steps**:
1. Check Vercel logs for database connection errors
2. Test database connectivity with a simple connection script
3. Verify database firewall/IP whitelist settings

**Solutions**:
- Ensure your PostgreSQL database allows connections from Vercel IPs
- Check if connection pooling is properly configured
- Verify SSL settings match your database requirements
- Consider using connection timeouts and retries

### 5. Environment Variable Issues

**Symptoms**: Authentication works locally but fails on Vercel

**Debug Steps**:
1. Check Vercel project settings → Environment Variables
2. Use the debug endpoint to verify variables are set:
   ```
   GET /api/debug/env
   ```
3. Compare local `.env` file with Vercel environment variables

**Required Environment Variables**:
```bash
DATABASE_URL=postgresql://username:password@host:port/database?sslmode=require
SESSION_SECRET=your-very-long-random-secret-string
NEXT_PUBLIC_APP_URL=https://your-domain.vercel.app
```

## Testing Your Setup

### Using the Built-in Debug Endpoints

1. **Health Check**: `GET /api/health`
2. **Environment Debug**: `GET /api/debug/env`
3. **Auth Debug**: `GET /api/debug/auth`
4. **Create Test User**: `POST /api/debug/create-test-user` (development only)

### Running the Test Script

```bash
# Test against local development server
node test-api.js http://localhost:5173

# Test against Vercel deployment
node test-api.js https://your-vercel-app.vercel.app
```

## Quick Fix Checklist

Before deploying to Vercel:

- [ ] Database URL is correctly formatted with `sslmode=require`
- [ ] `SESSION_SECRET` is set and sufficiently random
- [ ] `NEXT_PUBLIC_APP_URL` matches your Vercel domain exactly
- [ ] Database allows connections from Vercel IP addresses
- [ ] All required environment variables are set in Vercel project settings
- [ ] Test locally with `npm run dev` before deploying
- [ ] Check Vercel logs after deployment for any errors

## Getting Help

If you're still experiencing issues:

1. Check Vercel logs for specific error messages
2. Use the debug endpoints to gather diagnostic information
3. Test with the provided test script
4. Verify all environment variables are correctly set
5. Ensure your database is accessible and properly configured

The enhanced logging in the authentication handlers should provide detailed information about what's happening during the authentication process.