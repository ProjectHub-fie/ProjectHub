import { storage } from "./server/storage.js";
import bcrypt from "bcryptjs";

async function testAdminCreation() {
  try {
    console.log("Testing admin creation...");
    
    // Clear existing admins (for testing only)
    const existingAdmins = await storage.getAllAdmins();
    for (const admin of existingAdmins) {
      await storage.deleteAdmin(admin.id);
    }
    
    console.log("Cleared existing admins");
    
    // Create new admin
    const newPin = "999999";
    const newEmail = "test2@example.com";
    const newPassword = "newpassword123";
    const hash = await bcrypt.hash(newPassword, 10);
    
    await storage.setAdminPassword(newPin, newEmail, hash);
    console.log("✓ New admin created successfully");
    
    // Verify the admin was created
    const createdAdmin = await storage.getAdminByPin(newPin);
    if (createdAdmin) {
      console.log("✓ Admin found in database");
      console.log(`PIN: ${createdAdmin.pin}`);
      console.log(`Email: ${createdAdmin.email}`);
      
      // Test password verification
      const isValid = await bcrypt.compare(newPassword, createdAdmin.passwordHash);
      console.log(`Password verification: ${isValid ? "✓ SUCCESS" : "✗ FAILED"}`);
    } else {
      console.log("✗ Admin not found after creation");
    }
    
  } catch (error) {
    console.error("Admin creation test failed:", error);
  }
}

testAdminCreation();