import { config } from "dotenv";
import mongoose from "mongoose";

config();

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set");
}

// Convert PostgreSQL URL to MongoDB URL if needed
// Assuming DATABASE_URL is a MongoDB connection string
// If it's still PostgreSQL, you might need to update your environment variables
const mongoUrl = process.env.DATABASE_URL.replace('postgresql://', 'mongodb://').replace('postgres://', 'mongodb://');

export const connectDB = async () => {
  try {
    await mongoose.connect(mongoUrl);
    console.log('MongoDB connected successfully');
  } catch (error) {
    console.error('MongoDB connection error:', error);
    throw error;
  }
};

// Export mongoose instance for use in other files
export const db = mongoose.connection;
