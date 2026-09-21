import { users } from '../drizzle/schema.js';
import { db } from './db.js';
import { eq } from 'drizzle-orm';
import passport from 'passport';
import { Strategy as LocalStrategy } from 'passport-local';
import bcrypt from 'bcryptjs';

// Passport configuration
export function setupPassport(app: any) {
  passport.use(
    new LocalStrategy({ usernameField: 'email' }, async (email, password, done) => {
      try {
        const [user] = await db.select().from(users).where(eq(users.email, email));
        if (!user || !user.password) {
          return done(null, false, { message: 'Invalid email or password' });
        }
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
          return done(null, false, { message: 'Invalid email or password' });
        }
        return done(null, user);
      } catch (err) {
        return done(err);
      }
    })
  );

  passport.serializeUser((user: any, done) => {
    done(null, user.id);
  });

  passport.deserializeUser(async (id: string, done) => {
    try {
      const [user] = await db.select().from(users).where(eq(users.id, id));
      done(null, user);
    } catch (err) {
      done(err);
    }
  });

  app.use(passport.initialize());
  app.use(passport.session());
}

export const authenticate = (strategy: string, options: any, callback?: any) => {
  return passport.authenticate(strategy, options, callback);
};

// Middleware to check if user is authenticated and not blocked
export function requireAuth(req: any, res: any, next: any) {
  if (req.isAuthenticated()) {
    if (req.user?.isBlocked) {
      req.logout(() => {});
      return res.status(403).json({ message: "Your account has been blocked" });
    }
    return next();
  }
  res.status(401).json({ message: "Authentication required" });
}
