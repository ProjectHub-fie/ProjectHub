# ProjectHub - Developer Portfolio Platform

## 🚀 Quick Start

### Environment Variables
Create a `.env` file with the following variables:

```
SESSION_SECRET="your-session-secret-key"
DATABASE_URL="your-postgresql-connection-string"
```

### Development Commands

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Build for production
npm run build

# Type checking
npm run check

# Database migrations
npm run db:push
```

### Deployment

The application can be deployed to various platforms:
- Vercel (recommended)
- Replit
- Any Node.js hosting platform

### Features
- Modern React frontend with TypeScript
- Express.js backend API
- PostgreSQL database with Drizzle ORM
- Responsive design with Tailwind CSS
- Admin dashboard for content management
- User authentication and session management
- Project showcase functionality

### Tech Stack
- **Frontend**: React 18, TypeScript, Vite, Tailwind CSS, shadcn/ui
- **Backend**: Node.js, Express.js, TypeScript
- **Database**: PostgreSQL with Drizzle ORM
- **Deployment**: Vercel, Replit compatible

# ProjectHub Portfolio Web Application

## Overview

ProjectHub is a modern full-stack portfolio web application built with React and Node.js. It showcases developer projects, skills, and provides a contact interface. The application features user authentication, project request submissions, and a responsive design with dark/light theme support. Featured projects include Discord bots, dashboards, and developer utilities.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript, using Vite as the build tool
- **Styling**: Tailwind CSS with CSS variables for theming, supporting light/dark modes with system preference detection
- **UI Components**: Radix UI primitives with shadcn/ui component library (New York style)
- **State Management**: TanStack Query (React Query) for server state and caching
- **Routing**: Wouter for lightweight client-side routing
- **Form Handling**: React Hook Form with Zod validation

### Backend Architecture
- **Runtime**: Node.js with Express.js framework
- **Language**: TypeScript with ES modules
- **API Design**: RESTful API with route registration system in `server/routes.ts`
- **Development**: Hot reload via Vite middleware integration
- **Serverless Functions**: Vercel-compatible API routes in `/api` directory for deployment

### Data Storage
- **Database**: PostgreSQL with Drizzle ORM for type-safe database operations
- **Schema Location**: `shared/schema.ts` defines all database tables (users, sessions, project_requests)
- **Migrations**: Drizzle Kit manages schema migrations, output to `/migrations`
- **Session Storage**: PostgreSQL-backed sessions using connect-pg-simple

### Authentication
- **Strategy**: Passport.js with multiple strategies (Local, Discord OAuth)
- **Session Management**: Express sessions stored in PostgreSQL
- **Password Handling**: bcryptjs for hashing
- **Stateless Option**: Base64-encoded session tokens for Vercel serverless deployment

### Key Design Patterns
- **Shared Code**: The `/shared` directory contains schemas and types used by both client and server
- **Path Aliases**: `@/` maps to client source, `@shared/` maps to shared directory
- **Component Architecture**: UI components in `client/src/components/ui/`, feature components at `client/src/components/`
- **Storage Abstraction**: `IStorage` interface in `server/storage.ts` allows swapping database implementations

## External Dependencies

### Database
- **PostgreSQL**: Primary database, connection via `DATABASE_URL` environment variable
- **Drizzle ORM**: Type-safe query builder and schema management

### Authentication Providers
- **Discord OAuth**: Requires `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_CALLBACK_URL`
- **Google OAuth**: Schema supports Google ID (implementation ready)
- **Facebook OAuth**: Schema supports Facebook ID (implementation ready)

### Email Services
- **Resend**: Used for contact form and password reset emails, requires `RESEND_API_KEY`
- **SendGrid**: Alternative email integration available in dependencies

### Third-Party Services
- **Cloudflare Turnstile**: Used for admin login security verification
- **Firebase Data Connect**: Configuration present for potential Firebase integration
- **Vercel**: Deployment platform with serverless API routes in `/api` directory

### Required Environment Variables
- `DATABASE_URL`: PostgreSQL connection string (required)
- `SESSION_SECRET`: Secret for session encryption

### Optional Environment Variables
- `RESEND_API_KEY`: For email functionality (if needed in future)
- `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`: For Discord OAuth (if implemented)
- `CONTACT_EMAIL`: Email address to receive contact form submissions (optional, defaults to dev.projecthub.fie@gmail.com)