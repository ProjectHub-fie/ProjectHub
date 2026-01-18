import path from "path";
import express, { type Request, Response, NextFunction } from "express";
import { sql } from "drizzle-orm";
import { registerRoutes } from "./routes.js";
import { setupVite, serveStatic, log } from "./vite.js";
import { db } from "./db.js";
import { exec } from "child_process";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Run database push automatically on start in the background
if (process.env.NODE_ENV !== "production") {
  log("Initiating background database push...");
  exec("npx drizzle-kit push --force", (error, stdout, stderr) => {
    if (error) {
      log(`Database push failed: ${error.message}`);
      return;
    }
    if (stderr) {
      log(`Database push warning: ${stderr}`);
    }
    log("Database push completed successfully.");
  });
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

// Test database connection
async function testDatabaseConnection() {
  try {
    // For postgres-js, we can just run a simple query
    await db.execute(sql`SELECT 1 as test`);
    console.log("✅ Database connected successfully");
  } catch (error) {
    console.error("❌ Database connection failed:", (error as Error).message);
    console.log("🔄 Server will continue without database...");
  }
}

(async () => {
  // Trust proxy for Vercel
  app.set('trust proxy', 1);

  await testDatabaseConnection();
  const server = await registerRoutes(app);

  // Setup vite BEFORE catch-all handler in development
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // Catch-all handler for client-side routing - AFTER vite setup
  app.get('*', (req, res, next) => {
    // Skip API routes
    if (req.path.startsWith('/api')) {
      return next();
    }
    
    // For all other routes, serve the React app
    res.sendFile(path.resolve(import.meta.dirname, '..', 'client', 'index.html'));
  });

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || '5000', 10);
  server.listen({
    port,
    host: "0.0.0.0"
  }, () => {
    log(`serving on port ${port}`);
  });
})();