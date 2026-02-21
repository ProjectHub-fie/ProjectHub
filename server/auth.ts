import { Context } from 'hono';
import { users } from '../drizzle/schema.js';
import { db } from './db.js';
import { eq } from 'drizzle-orm';

// Extract session token from request headers
export function getSessionToken(c: Context): string | null {
  const authHeader = c.req.header('Authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }
  
  const sessionHeader = c.req.header('X-User-Session');
  if (sessionHeader) {
    return sessionHeader;
  }
  
  return null;
}

// Decode session token
export function decodeSessionToken(token: string): { id: string; email: string } | null {
  try {
    const decoded = Buffer.from(token, 'base64').toString('utf-8');
    const parsed = JSON.parse(decoded);
    if (parsed.id && parsed.email) {
      return { id: parsed.id, email: parsed.email };
    }
    return null;
  } catch {
    return null;
  }
}

// Authenticate request middleware
export const authenticateRequest = async (c: Context, next: () => Promise<void>) => {
  const token = getSessionToken(c);
  
  if (!token) {
    return c.json({ error: 'Authentication required' }, 401);
  }

  const sessionData = decodeSessionToken(token);
  if (!sessionData) {
    return c.json({ error: 'Invalid session token' }, 401);
  }

  try {
    // Fetch user from database
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, sessionData.id));

    if (!user) {
      return c.json({ error: 'User not found' }, 401);
    }

    if (user.isBlocked) {
      return c.json({ error: 'Account is blocked' }, 403);
    }

    // Attach user info to context
    c.set('user', user);

    await next();
  } catch (error) {
    console.error('Authentication error:', error);
    return c.json({ error: 'Authentication failed' }, 500);
  }
};

// Mock initialize and session for passport compatibility in routes
export const initialize = () => (req: any, res: any, next: any) => next();
export const session = () => (req: any, res: any, next: any) => next();
export const authenticate = (strategy: string, options: any, callback?: any) => (req: any, res: any, next: any) => {
  if (typeof options === 'function') {
    options(null, {}, {});
  } else if (callback) {
    callback(null, {}, {});
  }
  next();
};
