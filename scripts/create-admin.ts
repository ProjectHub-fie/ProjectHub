import { storage } from "../server/storage.js";
import bcrypt from "bcryptjs";

async function createAdmin() {
  const pin = "131313";
  const email = "admin@projecthub.dev";
  const password = "adminpassword";

  console.log(`Creating admin with PIN: ${pin}, Email: ${email}`);
  
  const hash = await bcrypt.hash(password, 10);
  await storage.setAdminPassword(pin, email, hash);
  
  console.log("Admin created successfully!");
  process.exit(0);
}

createAdmin().catch(err => {
  console.error("Failed to create admin:", err);
  process.exit(1);
});
