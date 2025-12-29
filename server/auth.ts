import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { Strategy as DiscordStrategy } from "passport-discord";
import bcrypt from "bcryptjs";
import { storage } from "./storage";
import type { User } from "@shared/schema";

// Local strategy (email/password)
passport.use(new LocalStrategy({
  usernameField: 'email',
  passwordField: 'password'
}, async (email, password, done) => {
  try {
    console.log('Attempting login for email:', email);
    
    if (!email || !password) {
      return done(null, false, { message: 'Email and password are required' });
    }

    const user = await storage.getUserByEmail(email);
    if (!user) {
      console.log('User not found:', email);
      return done(null, false, { message: 'Invalid email or password' });
    }

    if (!user.password) {
      console.log('User has no password (social login?):', email);
      return done(null, false, { message: 'Please login using your social account' });
    }

    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      console.log('Invalid password for user:', email);
      return done(null, false, { message: 'Invalid email or password' });
    }

    console.log('Login successful for user:', email);
    return done(null, user);
  } catch (error) {
    console.error('Login error:', error);
    return done(error);
  }
}));


// Discord Strategy
passport.use(new DiscordStrategy({
  clientID: process.env.DISCORD_CLIENT_ID || "placeholder",
  clientSecret: process.env.DISCORD_CLIENT_SECRET || "placeholder",
  callbackURL: process.env.DISCORD_CALLBACK_URL || "/api/auth/discord/callback",
  scope: ['identify', 'email']
}, async (accessToken, refreshToken, profile, done) => {
  if (process.env.DISCORD_CLIENT_ID === "placeholder") {
    return done(new Error("Discord Client ID is missing"));
  }
  try {
    let user = await storage.getUserBySocialId('discord', profile.id);

    if (!user) {
      user = await storage.upsertUser({
        discordId: profile.id,
        email: profile.email || null,
        firstName: profile.username || null,
        profileImageUrl: profile.avatar ? `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.png` : null,
      });
    }

    return done(null, user);
  } catch (error) {
    return done(error);
  }
}));


// Serialize user for session
passport.serializeUser((user: any, done) => {
  done(null, user.id);
});

// Deserialize user from session
passport.deserializeUser(async (id: string, done) => {
  try {
    const user = await storage.getUser(id);
    done(null, user);
  } catch (error) {
    done(error);
  }
});

export default passport;