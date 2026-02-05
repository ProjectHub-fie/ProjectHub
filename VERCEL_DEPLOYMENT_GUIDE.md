# Vercel Deployment Guide for ProjectHub

## Required Environment Variables

Add these variables in your Vercel project settings under "Environment Variables":

### Database Configuration
```
DATABASE_URL=postgresql://username:password@host:port/database?sslmode=require
```

### Session Security
```
SESSION_SECRET=your-very-long-random-secret-string-at-least-32-characters
```

### Email Service (Optional but recommended)
```
RESEND_API_KEY=re_your_resend_api_key_here
```

### Captcha (Optional but recommended for production)
```
TURNSTILE_SECRET_KEY=your-cloudflare-turnstile-secret-key
VITE_TURNSTILE_SITE_KEY=your-cloudflare-turnstile-site-key
```

### OAuth Providers (Optional)
```
DISCORD_CLIENT_ID=your-discord-client-id
DISCORD_CLIENT_SECRET=your-discord-client-secret
DISCORD_CALLBACK_URL=https://your-domain.vercel.app/api/auth/discord/callback
```

### Application URLs
```
NEXT_PUBLIC_APP_URL=https://your-domain.vercel.app
VERCEL_URL=https://your-domain.vercel.app
```

## Common Issues and Solutions

### 1. Login/Logout Not Working

**Symptoms**: Users can't log in or log out, sessions not persisting

**Solutions**:
- Ensure `SESSION_SECRET` is set and is sufficiently random
- Check that `DATABASE_URL` is correct and accessible
- Verify cookie settings in browser developer tools
- Make sure `NEXT_PUBLIC_APP_URL` matches your actual Vercel domain

### 2. CORS Errors

**Symptoms**: Browser console shows CORS errors during authentication

**Solutions**:
- Ensure `NEXT_PUBLIC_APP_URL` is set correctly
- Check that the API routes are properly configured for CORS
- Verify that `Access-Control-Allow-Credentials` is set to `true`

### 3. Database Connection Issues

**Symptoms**: Authentication fails with database errors

**Solutions**:
- Verify `DATABASE_URL` format and credentials
- Ensure your database allows connections from Vercel IPs
- Check that SSL is properly configured (`sslmode=require`)
- Test database connectivity using a simple connection script

### 4. Session Persistence Problems

**Symptoms**: Users get logged out frequently or sessions don't persist

**Solutions**:
- Increase session timeout in cookie settings
- Ensure `SameSite=None` and `Secure` flags are set for production
- Check that your database session store is working correctly
- Verify that cookies aren't being blocked by browser extensions

## Testing Your Deployment

1. **Health Check**: Visit `/api/health` to verify the API is working
2. **Registration Test**: Try registering a new user account
3. **Login Test**: Test logging in with the newly created account
4. **Session Test**: Verify that you stay logged in after page refresh
5. **Logout Test**: Ensure logout properly clears the session

## Debugging Tips

### Check Vercel Logs
```bash
# View function logs in Vercel dashboard
# Or use Vercel CLI:
vercel logs your-project-name
```

### Browser Developer Tools
- Check Network tab for failed API requests
- Inspect Application → Cookies to verify session cookies
- Look at Console for JavaScript errors

### Environment Verification
Create a simple API endpoint to verify environment variables:
```javascript
// Add to your API routes
app.get('/api/debug/env', (req, res) => {
  res.json({
    NODE_ENV: process.env.NODE_ENV,
    HAS_DATABASE_URL: !!process.env.DATABASE_URL,
    HAS_SESSION_SECRET: !!process.env.SESSION_SECRET,
    VERCEL_ENV: process.env.VERCEL_ENV
  });
});
```

## Production Checklist

- [ ] All environment variables are set
- [ ] Database connection tested and working
- [ ] SSL certificates are properly configured
- [ ] CORS settings are correct for your domain
- [ ] Session timeout is appropriate for your use case
- [ ] Error logging is configured
- [ ] Backup strategy is in place for database
- [ ] Monitoring is set up for critical endpoints

## Support

If you continue to experience issues:
1. Check the Vercel function logs for detailed error messages
2. Verify all environment variables are correctly set
3. Test database connectivity independently
4. Ensure your frontend is making requests to the correct API endpoints