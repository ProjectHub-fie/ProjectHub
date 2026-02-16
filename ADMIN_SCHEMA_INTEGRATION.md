# Admin Schema Integration Guide

## Overview
This document outlines the integration of the admin schema into the ProjectHub application, providing administrative capabilities for managing users, projects, and system operations.

## Features Added

### 1. Database Schema
- **Admin Users Table**: Manages administrative users with roles and permissions
- **Admin Actions Table**: Logs all administrative activities for audit purposes
- **Enhanced Enums**: Added admin-specific role and action type enumerations

### 2. API Endpoints
- `/api/admin/stats` - Dashboard statistics
- `/api/admin/users` - Manage admin users
- `/api/admin/requests/pending` - View pending project requests
- `/api/admin/requests/decision` - Approve/reject requests
- `/api/admin/actions` - View admin action logs

### 3. Frontend Components
- Admin Dashboard page with statistics overview
- Pending requests management interface
- Activity log viewer
- Role-based access control

## Database Structure

### Admin Users Table
```sql
CREATE TABLE admin_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role admin_role NOT NULL,
  permissions TEXT[] DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
```

### Admin Actions Table
```sql
CREATE TABLE admin_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id UUID NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  action_type admin_action_type NOT NULL,
  target_type admin_target_type NOT NULL,
  target_id UUID,
  details TEXT,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
```

## Roles and Permissions

### Available Roles
- `super_admin` - Full system access
- `admin` - Standard administrative access
- `moderator` - Limited moderation capabilities

### Available Permissions
- `manage_users` - User management
- `manage_projects` - Project management
- `manage_requests` - Request approval/rejection
- `view_analytics` - View system statistics
- `manage_settings` - System configuration

## API Usage Examples

### Get Admin Statistics
```bash
curl -H "X-User-Session: YOUR_SESSION_TOKEN" \
  https://your-domain.com/api/admin/stats
```

### Approve Project Request
```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -H "X-User-Session: YOUR_SESSION_TOKEN" \
  -d '{"requestId": "REQUEST_ID", "decision": "approve"}' \
  https://your-domain.com/api/admin/requests/decision
```

### Create Admin User
```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -H "X-User-Session: YOUR_SESSION_TOKEN" \
  -d '{"userId": "USER_ID", "role": "admin", "permissions": ["manage_users", "manage_requests"]}' \
  https://your-domain.com/api/admin/users
```

## Frontend Integration

### Accessing Admin Dashboard
Navigate to `/admin` route in the application. Only users with admin roles can access this page.

### Admin Dashboard Features
- **Overview Tab**: System statistics and metrics
- **Requests Tab**: Pending project requests with approve/reject options
- **Activity Tab**: Recent administrative actions and logs

## Setup Instructions

### 1. Database Migration
Run the migration to create admin tables:
```bash
npm run migrate
```

### 2. Create Initial Admin User
After migration, manually insert the first admin user:
```sql
INSERT INTO admin_users (user_id, role, permissions) 
VALUES ('YOUR_USER_ID', 'super_admin', ARRAY[
  'manage_users', 
  'manage_projects', 
  'manage_requests', 
  'view_analytics', 
  'manage_settings'
]);
```

### 3. Environment Configuration
Ensure the following environment variables are set:
- `DATABASE_URL` - PostgreSQL connection string
- `SESSION_SECRET` - Session encryption secret

## Security Considerations

### Authentication
- All admin endpoints require valid session tokens
- Admin middleware validates user roles and permissions
- IP address and user agent logging for security auditing

### Authorization
- Role-based access control (RBAC)
- Fine-grained permission system
- Audit logging for all administrative actions

### Data Protection
- Sensitive information logging is minimized
- Proper error handling to prevent information disclosure
- Input validation and sanitization

## Testing

### Unit Tests
```bash
npm run test:admin
```

### Integration Tests
```bash
npm run test:integration:admin
```

## Troubleshooting

### Common Issues
1. **403 Forbidden**: Check user admin role and permissions
2. **401 Unauthorized**: Verify session token validity
3. **Database Connection**: Ensure DATABASE_URL is correctly configured

### Debugging
Enable debug logging:
```bash
DEBUG=admin:* npm run dev
```

## Future Enhancements
- Multi-factor authentication for admin users
- Advanced analytics and reporting
- Automated backup and restore functionality
- Enhanced permission granularity
- Admin user invitation system

## Support
For issues or questions regarding the admin schema integration, please refer to the main documentation or contact the development team.