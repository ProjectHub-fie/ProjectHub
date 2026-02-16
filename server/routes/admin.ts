import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq, and, desc, count, sql } from 'drizzle-orm';
import { 
  adminUsers, 
  adminActions, 
  users, 
  projectRequests, 
  verifiedProjects,
  projectInteractions
} from '../../drizzle/schema.js';
import { db } from '../db.js';
import { authenticateRequest, authorizeAdmin } from '../auth.js';

const adminRoutes = new Hono();

// Middleware for admin authentication
adminRoutes.use('*', authenticateRequest);
adminRoutes.use('*', authorizeAdmin(['super_admin', 'admin']));

// Get admin dashboard statistics
adminRoutes.get('/stats', async (c) => {
  try {
    // Get counts
    const [userCount] = await db.select({ count: count() }).from(users);
    const [projectCount] = await db.select({ count: count() }).from(verifiedProjects);
    const [requestCount] = await db.select({ count: count() }).from(projectRequests);
    const [interactionCount] = await db.select({ count: count() }).from(projectInteractions);
    
    // Get pending requests
    const [pendingRequests] = await db
      .select({ count: count() })
      .from(projectRequests)
      .where(eq(projectRequests.status, 'pending'));
    
    // Get recent admin actions
    const recentActions = await db
      .select({
        actionType: adminActions.actionType,
        createdAt: adminActions.createdAt,
        adminName: sql`${users.firstName} || ' ' || ${users.lastName}`.as('admin_name')
      })
      .from(adminActions)
      .leftJoin(adminUsers, eq(adminActions.adminUserId, adminUsers.id))
      .leftJoin(users, eq(adminUsers.userId, users.id))
      .orderBy(desc(adminActions.createdAt))
      .limit(10);

    return c.json({
      stats: {
        totalUsers: userCount.count,
        totalProjects: projectCount.count,
        pendingRequests: pendingRequests.count,
        totalInteractions: interactionCount.count,
        recentActivity: recentActions.map(action => ({
          action: action.actionType,
          timestamp: action.createdAt,
          adminName: action.adminName || 'Unknown Admin'
        }))
      }
    });
  } catch (error) {
    console.error('Admin stats error:', error);
    return c.json({ error: 'Failed to fetch admin statistics' }, 500);
  }
});

// Get all admin users
adminRoutes.get('/users', async (c) => {
  try {
    const adminUsersList = await db
      .select({
        id: adminUsers.id,
        userId: adminUsers.userId,
        role: adminUsers.role,
        permissions: adminUsers.permissions,
        isActive: adminUsers.isActive,
        createdAt: adminUsers.createdAt,
        user: {
          email: users.email,
          firstName: users.firstName,
          lastName: users.lastName,
          profileImageUrl: users.profileImageUrl
        }
      })
      .from(adminUsers)
      .leftJoin(users, eq(adminUsers.userId, users.id))
      .orderBy(desc(adminUsers.createdAt));

    return c.json({ adminUsers: adminUsersList });
  } catch (error) {
    console.error('Get admin users error:', error);
    return c.json({ error: 'Failed to fetch admin users' }, 500);
  }
});

// Create/update admin user
const adminUserSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(['super_admin', 'admin', 'moderator']),
  permissions: z.array(z.string()).optional(),
  isActive: z.boolean().optional()
});

adminRoutes.post('/users', zValidator('json', adminUserSchema), async (c) => {
  try {
    const { userId, role, permissions = [], isActive = true } = c.req.valid('json');
    const requestingUser = c.get('user');

    // Check if user exists
    const [existingUser] = await db.select().from(users).where(eq(users.id, userId));
    if (!existingUser) {
      return c.json({ error: 'User not found' }, 404);
    }

    // Check if admin user already exists
    const [existingAdmin] = await db.select().from(adminUsers).where(eq(adminUsers.userId, userId));
    
    let result;
    if (existingAdmin) {
      // Update existing admin user
      [result] = await db.update(adminUsers)
        .set({
          role,
          permissions,
          isActive,
          updatedAt: new Date()
        })
        .where(eq(adminUsers.id, existingAdmin.id))
        .returning();
    } else {
      // Create new admin user
      [result] = await db.insert(adminUsers)
        .values({
          userId,
          role,
          permissions,
          isActive
        })
        .returning();
    }

    // Log admin action
    await db.insert(adminActions).values({
      adminUserId: requestingUser.adminId,
      actionType: existingAdmin ? 'admin_updated' : 'admin_created',
      targetType: 'user',
      targetId: userId,
      details: JSON.stringify({ role, permissions, isActive })
    });

    return c.json({ adminUser: result });
  } catch (error) {
    console.error('Create/update admin user error:', error);
    return c.json({ error: 'Failed to manage admin user' }, 500);
  }
});

// Get pending project requests
adminRoutes.get('/requests/pending', async (c) => {
  try {
    const pendingRequests = await db
      .select({
        id: projectRequests.id,
        title: projectRequests.title,
        description: projectRequests.description,
        budget: projectRequests.budget,
        timeline: projectRequests.timeline,
        createdAt: projectRequests.createdAt,
        user: {
          id: users.id,
          email: users.email,
          firstName: users.firstName,
          lastName: users.lastName
        }
      })
      .from(projectRequests)
      .leftJoin(users, eq(projectRequests.userId, users.id))
      .where(eq(projectRequests.status, 'pending'))
      .orderBy(desc(projectRequests.createdAt));

    return c.json({ requests: pendingRequests });
  } catch (error) {
    console.error('Get pending requests error:', error);
    return c.json({ error: 'Failed to fetch pending requests' }, 500);
  }
});

// Approve/reject project request
const requestDecisionSchema = z.object({
  requestId: z.string().uuid(),
  decision: z.enum(['approve', 'reject']),
  reason: z.string().optional()
});

adminRoutes.post('/requests/decision', zValidator('json', requestDecisionSchema), async (c) => {
  try {
    const { requestId, decision, reason } = c.req.valid('json');
    const requestingUser = c.get('user');

    // Update request status
    const newStatus = decision === 'approve' ? 'approved' : 'rejected';
    const [updatedRequest] = await db
      .update(projectRequests)
      .set({ 
        status: newStatus,
        updatedAt: new Date()
      })
      .where(eq(projectRequests.id, requestId))
      .returning();

    if (!updatedRequest) {
      return c.json({ error: 'Request not found' }, 404);
    }

    // Log admin action
    await db.insert(adminActions).values({
      adminUserId: requestingUser.adminId,
      actionType: `request_${decision}d`,
      targetType: 'request',
      targetId: requestId,
      details: reason ? JSON.stringify({ reason }) : undefined
    });

    return c.json({ 
      message: `Request ${decision}d successfully`,
      request: updatedRequest
    });
  } catch (error) {
    console.error('Request decision error:', error);
    return c.json({ error: 'Failed to process request decision' }, 500);
  }
});

// Get admin action logs
adminRoutes.get('/actions', async (c) => {
  try {
    const limit = parseInt(c.req.query('limit') || '50');
    const offset = parseInt(c.req.query('offset') || '0');

    const actions = await db
      .select({
        id: adminActions.id,
        actionType: adminActions.actionType,
        targetType: adminActions.targetType,
        targetId: adminActions.targetId,
        details: adminActions.details,
        ipAddress: adminActions.ipAddress,
        createdAt: adminActions.createdAt,
        adminUser: {
          id: adminUsers.id,
          role: adminUsers.role
        },
        user: {
          email: users.email,
          firstName: users.firstName,
          lastName: users.lastName
        }
      })
      .from(adminActions)
      .leftJoin(adminUsers, eq(adminActions.adminUserId, adminUsers.id))
      .leftJoin(users, eq(adminUsers.userId, users.id))
      .orderBy(desc(adminActions.createdAt))
      .limit(limit)
      .offset(offset);

    return c.json({ actions });
  } catch (error) {
    console.error('Get admin actions error:', error);
    return c.json({ error: 'Failed to fetch admin actions' }, 500);
  }
});

export default adminRoutes;