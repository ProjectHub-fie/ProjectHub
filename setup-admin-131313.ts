import { config } from 'dotenv';
config(); // Load environment variables first

import { storage } from "./server/storage.js";
import bcrypt from "bcryptjs";

async function createSpecificAdmin() {
  try {
    console.log("Creating admin account with PIN 131313 and password adadad...");
    
    // Check if admin with PIN 131313 already exists
    const existingAdmin = await storage.getAdminByPin('131313');
    if (existingAdmin) {
      console.log("Admin with PIN 131313 already exists, removing existing entry...");
      await storage.deleteAdmin(existingAdmin.id);
    }
    
    // Create new admin with specified credentials
    const pin = "131313";
    const password = "adadad";
    const email = "admin131313@projecthub.com";
    const role = "admin"; // Using admin role instead of owner
    
    const hash = await bcrypt.hash(password, 10);
    await storage.setAdminPassword(pin, email, hash, role);
    
    console.log("✓ Admin created successfully");
    console.log(`PIN: ${pin}`);
    console.log(`Password: ${password}`);
    console.log(`Email: ${email}`);
    console.log(`Role: ${role}`);
    
    // Verify the admin was created
    const createdAdmin = await storage.getAdminByPin(pin);
    if (createdAdmin) {
      console.log("✓ Admin verified in database");
      console.log(`Database ID: ${createdAdmin.id}`);
      console.log(`Role in DB: ${createdAdmin.role}`);
      console.log(`Email in DB: ${createdAdmin.email}`);
    }
    
  } catch (error) {
    console.error("Admin creation failed:", error);
  }
}

createSpecificAdmin();