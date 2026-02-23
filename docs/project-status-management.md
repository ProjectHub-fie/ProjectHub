# Project Status Management

## Overview

This feature allows administrators to manage project request statuses through the admin dashboard. Users with appropriate permissions can view, update, and track project requests with different status levels.

## Features

### Status Levels
- **Pending** - New requests awaiting review
- **In Review** - Currently being evaluated by admins
- **Approved** - Accepted and ready for implementation
- **Rejected** - Declined requests
- **Completed** - Finished projects

### Permissions
- **Moderators**: Can view and update project statuses
- **Admins**: Full access including deletion capabilities
- **Owners**: Complete control over all project management

## Implementation Details

### Backend API Endpoints

#### Get All Project Requests
```http
GET /api/project-requests
Authorization: Bearer <session-token>
```

#### Update Project Status
```http
PUT /api/projects/:id/status
Authorization: Bearer <session-token>
Content-Type: application/json

{
  "status": "approved"
}
```

#### Delete Project Request
```http
DELETE /api/projects/:id
Authorization: Bearer <session-token>
```

### Frontend Components

#### ProjectStatusSelector
A reusable component for selecting and updating project statuses.

```tsx
<ProjectStatusSelector
  currentStatus="pending"
  onStatusChange={(newStatus) => handleStatusChange(id, newStatus)}
  disabled={isLoading}
/>
```

#### useProjectRequests Hook
Custom hook for managing project request data and mutations.

```tsx
const { 
  requests, 
  requestsLoading, 
  updateStatus, 
  deleteRequest,
  getStatusCounts
} = useProjectRequests();
```

### Database Schema

The project requests are stored in the `project_requests` table with the following structure:

```sql
CREATE TABLE project_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  budget TEXT,
  timeline TEXT,
  technologies TEXT[],
  status project_request_status DEFAULT 'pending' NOT NULL,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW() NOT NULL
);

CREATE TYPE project_request_status AS ENUM (
  'pending',
  'in_review', 
  'approved',
  'rejected',
  'completed'
);
```

## Usage Examples

### Admin Dashboard Integration

```tsx
{canManageProjects && (
  <div className="mt-8">
    <Card>
      <CardHeader>
        <CardTitle>Project Requests</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {requests.map((request) => (
              <TableRow key={request.id}>
                <TableCell>{request.title}</TableCell>
                <TableCell>
                  <ProjectStatusSelector
                    currentStatus={request.status}
                    onStatusChange={(status) => updateStatus({ 
                      id: request.id, 
                      status 
                    })}
                  />
                </TableCell>
                <TableCell>
                  <Button onClick={() => deleteRequest(request.id)}>
                    Delete
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  </div>
)}
```

### Testing

Run the database test script:
```bash
npm run test:project-status
# or
npx tsx scripts/test-project-status-update.ts
```

## Error Handling

The system includes comprehensive error handling:
- Validation of status values against enum constraints
- User-friendly error messages
- Loading states during API operations
- Optimistic UI updates with rollback on failure

## Security Considerations

- Role-based access control enforced on all endpoints
- Session authentication required for all operations
- Input validation for status updates
- Proper error messages that don't expose internal details

## Future Enhancements

- [ ] Project request details modal/view
- [ ] Bulk status updates
- [ ] Status change history tracking
- [ ] Email notifications for status changes
- [ ] Advanced filtering and sorting options
- [ ] Export functionality for project reports