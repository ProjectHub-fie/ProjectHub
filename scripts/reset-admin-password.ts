import { storage } from "../server/storage.js";
import bcrypt from "bcryptjs";

async function resetAdminPassword() {
  const pin = "131313";
  const newPassword = "adminpassword";
  
  try {
    console.log(`Resetting password for admin with PIN: ${pin}`);
    
    // Hash the new password
    const hash = await bcrypt.hash(newPassword, 10);
    
    // Update the admin password in the database
    await storage.setAdminPassword(pin, "admin@projecthub.dev", hash);
    
    console.log("Admin password reset successfully!");
    console.log(`PIN: ${pin}`);
    console.log(`Password: ${newPassword}`);
    
    process.exit(0);
  } catch (error) {
    console.error("Failed to reset admin password:", error);
    process.exit(1);
  }
}

resetAdminPassword();