// Environment variable validation utility
export function validateEnvironment(): { 
  isValid: boolean; 
  errors: string[]; 
  warnings: string[] 
} {
  const errors: string[] = [];
  const warnings: string[] = [];
  
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

// Utility function to get required environment variables
export function getRequiredEnvVars(): Record<string, string | undefined> {
  return {
    DATABASE_URL: import.meta.env.DATABASE_URL,
    SESSION_SECRET: import.meta.env.SESSION_SECRET
  };
}