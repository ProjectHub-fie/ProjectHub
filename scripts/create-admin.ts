zimport { storage } from "../server/storage.js";
import bcrypt from "bcryptjs";

npx drizzle-kit generateasync function createDefaultOwner() {
  try {
    console.log("Creating default owner account...");
    
    // Check if owner already exists
    const existingAdmins = await storage.getAllAdmins();
    const ownerExists = existingAdmins.some(admin => admin.role === 'owner');
    
    if (ownerExists) {
      console.log("Owner account already exists");
      return;
    }
    
    // Clear any existing admins with PIN 131313
    const existing131313 = existingAdmins.find(admin => admin.pin === '131313');
    if (existing131313) {
      await storage.deleteAdmin(existing131313.id);
      console.log("Removed existing 131313 admin");
    }
    
    // Create default owner
    const pin = "131313";
    const password = "adminpassword";
    const email = "owner@projecthub.com";
    const role = "owner";
    
    const hash = await bcrypt.hash(password, 10);
    await storage.setAdminPassword(pin, email, hash, role);
    
    console.log("✓ Default owner created successfully");
    console.log(`PIN: ${pin}`);
    console.log(`Password: ${password}`);
    console.log(`Email: ${email}`);
    console.log(`Role: ${role}`);
    
    // Verify the owner was created
    const createdOwner = await storage.getAdminByPin(pin);
    if (createdOwner) {
      console.log("✓ Owner verified in database");
      console.log(`Role in DB: ${createdOwner.role}`);
    }
    
  } catch (error) {
    console.error("Owner creation failed:", error);
  }
}

createDefaultOwner();