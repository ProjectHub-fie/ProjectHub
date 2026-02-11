# 🚀 Complete Vercel Deployment Guide

This guide provides step-by-step instructions for deploying ProjectHub to Vercel successfully.

## 📋 Prerequisites

Before deploying, ensure you have:

1. A [Vercel account](https://vercel.com)
2. The [Vercel CLI](https://vercel.com/cli) installed (`npm i -g vercel`)
3. A PostgreSQL database (Neon, Supabase, or similar)
4. All required environment variables ready

## 🔧 Required Environment Variables

Set these in your Vercel project dashboard:

```bash
# Database connection
DATABASE_URL=your_postgresql_connection_string

# Session security
SESSION_SECRET=your_random_secret_key_here

# Application URL (replace with your actual Vercel URL)
NEXT_PUBLIC_APP_URL=https://your-app.vercel.app

# Optional but recommended
NODE_ENV=production
```

## 🚀 Deployment Steps

### Method 1: Using Vercel CLI (Recommended)

1. **Install Vercel CLI** (if not already installed):
   ```bash
   npm install -g vercel
   ```

2. **Deploy to Vercel**:
   ```bash
   vercel deploy --prod
   ```

3. **Set environment variables** when prompted, or set them in the Vercel dashboard later.

### Method 2: Using Git Integration

1. Push your code to GitHub/GitLab/Bitbucket
2. Connect your repository to Vercel
3. Configure the project settings:
   - Framework Preset: `Other`
   - Build Command: `npm run build`
   - Output Directory: `dist/public`
   - Install Command: `npm install`

## 🔍 Verification Steps

After deployment, verify everything works:

1. **Check health endpoint**:
   ```
   GET https://your-app.vercel.app/api/health
   ```

2. **Test API endpoints**:
   ```
   GET https://your-app.vercel.app/api/projects
   GET https://your-app.vercel.app/api/debug/env
   ```

3. **Verify frontend loads**:
   Visit your deployed URL and ensure the React app loads correctly

## ⚠️ Common Issues and Solutions

### Issue 1: Build Failures
**Symptoms**: Deployment fails during build phase
**Solutions**:
- Check that all dependencies are listed in package.json
- Verify vite.config.js is not excluded in .vercelignore
- Run `npm run build` locally to test

### Issue 2: API Endpoints Not Working
**Symptoms**: 404 errors on /api/* routes
**Solutions**:
- Verify vercel.json rewrites configuration
- Check that api/index.js exists and exports default function
- Ensure functions runtime is set correctly

### Issue 3: Database Connection Issues
**Symptoms**: Authentication or data loading fails
**Solutions**:
- Verify DATABASE_URL is correctly set
- Check database connection string format
- Ensure database allows connections from Vercel IPs

### Issue 4: CORS Errors
**Symptoms**: Frontend can't communicate with backend
**Solutions**:
- Verify NEXT_PUBLIC_APP_URL matches your Vercel deployment URL
- Check CORS headers in vercel.json
- Ensure API responses include proper Access-Control headers

## 🛠️ Troubleshooting Commands

```bash
# Test local build
npm run build

# Verify deployment configuration
node scripts/verify-vercel-deployment.mjs

# Check Vercel logs
vercel logs

# Redeploy
vercel deploy --prod
```

## 📊 Monitoring Your Deployment

### Vercel Dashboard
- Monitor deployments and logs
- View performance metrics
- Check function execution counts

### Health Checks
Regular endpoints to monitor:
- `/api/health` - Basic system health
- `/api/debug/env` - Environment variable status
- `/api/projects` - API functionality test

## 🔒 Security Considerations

1. **Environment Variables**: Never commit sensitive values to git
2. **Database Security**: Use connection pooling and proper authentication
3. **Rate Limiting**: Consider implementing rate limiting for API endpoints
4. **HTTPS**: Vercel automatically provides SSL certificates

## 🔄 Updates and Redeployment

To update your deployed application:

1. Make changes to your code
2. Commit and push to your repository
3. Vercel will automatically deploy (with Git integration)
4. Or run `vercel deploy --prod` for manual deployment

## 💡 Pro Tips

1. **Preview Deployments**: Use `vercel deploy` (without --prod) for preview builds
2. **Environment Aliases**: Use different environment variables for preview vs production
3. **Custom Domains**: Configure custom domains in Vercel dashboard
4. **Analytics**: Enable Vercel Analytics for performance insights

## 🆘 Need Help?

If you encounter issues:

1. Check the [Vercel Documentation](https://vercel.com/docs)
2. Review deployment logs in Vercel dashboard
3. Verify all configuration files are correct
4. Test locally before deploying
5. Check the troubleshooting section above

---

**Ready to deploy?** Run `vercel deploy --prod` and follow the prompts!