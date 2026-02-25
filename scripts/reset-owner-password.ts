import { storage } from "../server/storage.js";
import bcrypt from "bcryptjs";

async function resetOwnerPassword() {
  try {
    console.log("Resetting owner password...");
    
    const pin = "131313";
    const newPassword = "adminpassword";
    
    // Get existing admin
    const existingAdmin = await storage.getAdminByPin(pin);
    if (!existingAdmin) {
      console.log("Admin with PIN 131313 not found");
      return;
    }
    
    console.log(`Found admin with PIN ${pin}, current role: ${existingAdmin.role}`);
    
    // Hash new password
    const hash = await bcrypt.hash(newPassword, 10);
    
    // Update password
    await storage.setAdminPassword(pin, existingAdmin.email, hash, existingAdmin.role);
    
    console.log("Password reset successfully!");
    console.log(`New password: ${newPassword}`);
    
    // Verify the update
    const updatedAdmin = await storage.getAdminByPin(pin);
    if (updatedAdmin) {
      const isPasswordValid = await bcrypt.compare(newPassword, updatedAdmin.passwordHash);
      console.log(`Password verification: ${isPasswordValid ? 'SUCCESS' : 'FAILED'}`);
    }
    
  } catch (error) {
    console.error("Password reset failed:", error);
  }
}

resetOwnerPassword();