import { storage } from "../server/storage.js";
import bcrypt from "bcryptjs";

async function testLogin() {
  try {
    console.log("Testing admin login functionality...");
    
    // Check existing admins
    const admins = await storage.getAllAdmins();
    console.log(`Found ${admins.length} admin(s)`);
    
    for (const admin of admins) {
      console.log(`Admin PIN: ${admin.pin}, Role: ${admin.role}`);
      
      // Test password verification
      const isPasswordValid = await bcrypt.compare("adminpassword", admin.passwordHash);
      console.log(`Password valid for PIN ${admin.pin}: ${isPasswordValid}`);
    }
    
    // Try to get admin by PIN
    const testAdmin = await storage.getAdminByPin("131313");
    if (testAdmin) {
      console.log("\nFound admin with PIN 131313:");
      console.log(`- ID: ${testAdmin.id}`);
      console.log(`- Role: ${testAdmin.role}`);
      console.log(`- Email: ${testAdmin.email || 'N/A'}`);
    } else {
      console.log("\nNo admin found with PIN 131313");
    }
    
  } catch (error) {
    console.error("Test failed:", error);
  }
}

testLogin();