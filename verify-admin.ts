import { config } from 'dotenv';
config();

import { storage } from "./server/storage.js";

async function verifyAdmin() {
  try {
    console.log("Verifying admin accounts in database...");
    
    // Get all admins
    const allAdmins = await storage.getAllAdmins();
    console.log(`Total admins found: ${allAdmins.length}`);
    
    // Check specifically for PIN 131313
    const specificAdmin = await storage.getAdminByPin('131313');
    if (specificAdmin) {
      console.log("✓ Found admin with PIN 131313:");
      console.log(`  ID: ${specificAdmin.id}`);
      console.log(`  Email: ${specificAdmin.email}`);
      console.log(`  Role: ${specificAdmin.role}`);
      console.log(`  PIN: ${specificAdmin.pin}`);
    } else {
      console.log("✗ No admin found with PIN 131313");
    }
    
    // List all admins
    if (allAdmins.length > 0) {
      console.log("\nAll admin accounts:");
      allAdmins.forEach((admin, index) => {
        console.log(`${index + 1}. PIN: ${admin.pin}, Email: ${admin.email}, Role: ${admin.role}`);
      });
    }
    
  } catch (error) {
    console.error("Verification failed:", error);
  }
}

verifyAdmin();