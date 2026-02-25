import { storage } from "../server/storage.js";

async function verifyAdmins() {
  try {
    console.log("Checking existing admin accounts...");
    
    const admins = await storage.getAllAdmins();
    
    if (admins.length === 0) {
      console.log("No admin accounts found");
      return;
    }
    
    console.log(`Found ${admins.length} admin account(s):`);
    admins.forEach((admin, index) => {
      console.log(`${index + 1}. PIN: ${admin.pin}, Role: ${admin.role}, Email: ${admin.email || 'N/A'}`);
    });
    
    const ownerExists = admins.some(admin => admin.role === 'owner');
    console.log(`\nOwner account exists: ${ownerExists ? 'Yes' : 'No'}`);
    
  } catch (error) {
    console.error("Verification failed:", error);
  }
}

verifyAdmins();