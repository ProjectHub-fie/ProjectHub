import { Context } from 'hono';
import { eq } from 'drizzle-orm';
import { users, adminUsers } from '../drizzle/schema.js';
import { db } from './db.js';

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
export async function authenticateRequest(c: Context, next: () => Promise<void>) {
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

    // Check if user is admin
    const [adminUser] = await db
      .select()
      .from(adminUsers)
      .where(and(
        eq(adminUsers.userId, user.id),
        eq(adminUsers.isActive, true)
      ));

    // Attach user and admin info to context
    c.set('user', {
      ...user,
      adminId: adminUser?.id,
      isAdmin: !!adminUser,
      adminRole: adminUser?.role,
      adminPermissions: adminUser?.permissions || []
    });

    await next();
  } catch (error) {
    console.error('Authentication error:', error);
    return c.json({ error: 'Authentication failed' }, 500);
  }
}

// Admin authorization middleware
export function authorizeAdmin(requiredRoles: string[] = []) {
  return async (c: Context, next: () => Promise<void>) => {
    const user = c.get('user');
    
    if (!user.isAdmin) {
      return c.json({ error: 'Admin access required' }, 403);
    }

    if (requiredRoles.length > 0 && !requiredRoles.includes(user.adminRole)) {
      return c.json({ error: 'Insufficient admin privileges' }, 403);
    }

    await next();
  };
}

// Permission check middleware
export function requirePermission(permission: string) {
  return async (c: Context, next: () => Promise<void>) => {
    const user = c.get('user');
    
    if (!user.isAdmin) {
      return c.json({ error: 'Admin access required' }, 403);
    }

    if (!user.adminPermissions.includes(permission)) {
      return c.json({ error: `Permission '${permission}' required` }, 403);
    }

    await next();
  };
}