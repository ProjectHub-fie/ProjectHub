import { storage } from "../server/storage.js";
import bcrypt from "bcryptjs";

async function testFullLogin() {
  try {
    console.log("Testing full login flow...");
    
    const pin = "131313";
    const password = "adminpassword";
    
    // Test getting admin by PIN
    const admin = await storage.getAdminByPin(pin);
    if (!admin) {
      console.log("Admin not found!");
      return;
    }
    
    console.log(`Found admin: PIN=${admin.pin}, Role=${admin.role}`);
    
    // Test password verification
    const isPasswordValid = await bcrypt.compare(password, admin.passwordHash);
    console.log(`Password verification: ${isPasswordValid ? 'SUCCESS' : 'FAILED'}`);
    
    if (isPasswordValid) {
      console.log("✓ Login would be successful!");
      console.log(`✓ Role assigned: ${admin.role}`);
      console.log(`✓ Owner permissions: ${admin.role === 'owner' ? 'YES' : 'NO'}`);
    }
    
  } catch (error) {
    console.error("Login test failed:", error);
  }
}

testFullLogin();