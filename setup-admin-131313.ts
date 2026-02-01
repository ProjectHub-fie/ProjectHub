import { storage } from "./server/storage.js";
import bcrypt from "bcryptjs";

async function setupAdmin131313() {
  try {
    console.log("Setting up admin with PIN: 131313");
    
    // Get all existing admins
    const existingAdmins = await storage.getAllAdmins();
    console.log(`Found ${existingAdmins.length} existing admins`);
    
    // Delete all existing admins
    for (const admin of existingAdmins) {
      console.log(`Deleting admin with PIN: ${admin.pin}`);
      await storage.deleteAdmin(admin.id);
    }
    
    if (existingAdmins.length > 0) {
      console.log("✓ All existing admins deleted");
    }
    
    // Create new admin with PIN 131313 and password adadad
    const newPin = "131313";
    const newPassword = "adadad";
    const email = "admin@example.com";
    
    const hash = await bcrypt.hash(newPassword, 10);
    await storage.setAdminPassword(newPin, email, hash);
    
    console.log("✓ New admin created successfully");
    console.log(`PIN: ${newPin}`);
    console.log(`Password: ${newPassword}`);
    console.log(`Email: ${email}`);
    
    // Verify the new admin was created
    const createdAdmin = await storage.getAdminByPin(newPin);
    if (createdAdmin) {
      console.log("✓ Admin verified in database");
      
      // Test password verification
      const isValid = await bcrypt.compare(newPassword, createdAdmin.passwordHash);
      console.log(`Password verification: ${isValid ? "✓ SUCCESS" : "✗ FAILED"}`);
    }
    
  } catch (error) {
    console.error("Admin setup failed:", error);
  }
}

setupAdmin131313();