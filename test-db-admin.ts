import { storage } from "./server/storage.js";
import bcrypt from "bcryptjs";

async function testAdminAuth() {
  try {
    console.log("Testing admin authentication...");
    
    // Get all admins
    const admins = await storage.getAllAdmins();
    console.log(`Found ${admins.length} admins in database`);
    
    if (admins.length > 0) {
      const admin = admins[0];
      console.log(`Testing login for PIN: ${admin.pin}`);
      
      // Test with getAdminByPin function
      const foundAdmin = await storage.getAdminByPin(admin.pin);
      if (foundAdmin) {
        console.log("✓ Admin found by PIN");
        console.log(`Email: ${foundAdmin.email}`);
        console.log(`Password hash length: ${foundAdmin.passwordHash?.length || 'N/A'}`);
      } else {
        console.log("✗ Admin not found by PIN");
      }
    }
    
  } catch (error) {
    console.error("Database test failed:", error);
  }
}

testAdminAuth();