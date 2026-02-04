// Environment variable validation utility
export function validateEnvironment(): { 
  isValid: boolean; 
  errors: string[]; 
  warnings: string[] 
} {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  // Check Turnstile configuration
  const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY || import.meta.env.CF_TURNSTILE_SITE_KEY;
  const secretKey = import.meta.env.CF_TURNSTILE_SECRET_KEY;
  
  if (!siteKey) {
    errors.push('CF_TURNSTILE_SITE_KEY is not configured');
  } else if (!siteKey.startsWith('0x4AAAAA') && !siteKey.startsWith('1x')) {
    warnings.push('Turnstile site key format may be invalid - should start with "0x4AAAAA" or "1x"');
  }
  
  if (!secretKey) {
    errors.push('CF_TURNSTILE_SECRET_KEY is not configured');
  } else if (!secretKey.startsWith('0x4AAAAA') && !secretKey.startsWith('1x')) {
    warnings.push('Turnstile secret key format may be invalid - should start with "0x4AAAAA" or "1x"');
  }
  
  // Check database configuration
  if (!import.meta.env.DATABASE_URL) {
    errors.push('DATABASE_URL is not configured');
  }
  
  // Check session secret
  if (!import.meta.env.SESSION_SECRET) {
    errors.push('SESSION_SECRET is not configured');
  }
  
  return {
    isValid: errors.length === 0,
    errors,
    warnings
  };
}

// Utility function to get Turnstile site key with fallback
export function getTurnstileSiteKey(): string {
  return import.meta.env.VITE_TURNSTILE_SITE_KEY || 
         import.meta.env.CF_TURNSTILE_SITE_KEY || 
         "1x00000000000000000000AA"; // Fallback test key
}