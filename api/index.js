const express = require('express');
const path = require('path');
const session = require('express-session');
const passport = require('passport');
const bcrypt = require('bcryptjs');
const pg = require('pg');
const connectPgSimple = require('connect-pg-simple');
const { createServer } = require('http');

// Import logic from our existing files
const { storage } = require('./lib/storage');
const passportConfig = require('./lib/auth');
const { insertProjectRequestSchema } = require('../shared/schema');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.set('trust proxy', 1);

// Session configuration
const PgSession = connectPgSimple(session);
const pgPool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

app.use(session({
  store: new PgSession({
    pool: pgPool,
    tableName: 'sessions',
    createTableIfMissing: true,
  }),
  secret: process.env.SESSION_SECRET || 'fallback-secret-key',
  resave: false,
  saveUninitialized: false,
  proxy: true,
  cookie: {
    secure: true,
    sameSite: 'none',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000
  }
}));

app.use(passport.initialize());
app.use(passport.session());

// Helper for required auth
const requireAuth = (req, res, next) => {
  if (req.isAuthenticated()) {
    if (req.user && req.user.isBlocked) {
      req.logout(() => {});
      return res.status(403).json({ message: "Your account has been blocked" });
    }
    return next();
  }
  res.status(401).json({ message: "Authentication required" });
};

// API Routes
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, firstName, lastName } = req.body;
    if (!email || !password || !firstName || !lastName) {
      return res.status(400).json({ message: "All fields are required" });
    }
    const existingUser = await storage.getUserByEmail(email);
    if (existingUser) {
      return res.status(400).json({ message: "Email already registered" });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await storage.upsertUser({ email, firstName, lastName, password: hashedPassword });
    req.login(user, (err) => {
      if (err) return res.status(500).json({ message: "Login failed" });
      res.json({ user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName } });
    });
  } catch (error) {
    res.status(500).json({ message: "Registration failed" });
  }
});

app.post('/api/auth/login', (req, res, next) => {
  passport.authenticate('local', (err, user, info) => {
    if (err) return res.status(500).json({ message: "Login failed" });
    if (!user) return res.status(401).json({ message: info ? info.message : "Invalid credentials" });
    req.login(user, (loginErr) => {
      if (loginErr) return res.status(500).json({ message: "Login failed" });
      res.json({ user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName } });
    });
  })(req, res, next);
});

app.post('/api/auth/logout', (req, res) => {
  req.logout((err) => {
    if (err) return res.status(500).json({ message: "Logout failed" });
    res.json({ message: "Logged out successfully" });
  });
});

app.get('/api/auth/user', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// Catch-all for API
app.all('/api/*', (req, res) => {
  res.status(404).json({ message: "Not Found" });
});

module.exports = app;