import express, { type Request, type Response, type NextFunction } from "express";
import path from "path";
import { fileURLToPath } from "url";
import { registerRoutes } from "./routes.js";
import { setupVite, serveStatic, log } from "./vite.js";

// Polyfill for __dirname in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Trust proxy for Vercel/production environments
app.set('trust proxy', 1);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Enhanced error logging middleware
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  console.error('Express error:', {
    message: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method
  });
  
  // Only send response if headers haven't been sent yet
  if (!res.headersSent) {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    res.status(status).json({ message });
  }
  
  // Don't call next() after sending response
});

// Register API routes
await registerRoutes(app);

// ALWAYS serve the app on the port specified in the environment variable PORT
// Other ports are firewalled. Default to 5000 if not specified.
// this serves both the API and the client.
// It is the only port that is not firewalled.
const port = parseInt(process.env.PORT || '5000', 10);

// Create HTTP server
const server = app.listen(port, () => {
  console.log(`[${new Date().toLocaleTimeString()}] [express] serving on port ${port}`);
});

// Setup vite BEFORE catch-all handler in development
if (app.get("env") === "development") {
  await setupVite(app, server);
} else {
  serveStatic(app);
}

// API 404 handler
app.use('/api/*', (req, res) => {
  res.status(404).json({ message: 'API endpoint not found' });
});

// Catch-all handler for client-side routing - AFTER vite setup
app.get('*', (req, res, next) => {
  // Skip API routes
  if (req.path.startsWith('/api')) {
    return next();
  }
  
  // For all other routes, serve the React app
  res.sendFile(path.resolve(import.meta.dirname, '..', 'client', 'index.html'));
});

// Global error handler - this should be the last middleware
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  // Final error handler - only send response if not already sent
  if (!res.headersSent) {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    res.status(status).json({ message });
  }
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('Process terminated');
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  server.close(() => {
    console.log('Process terminated');
  });
});
