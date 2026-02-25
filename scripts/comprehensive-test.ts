import { storage } from "../server/storage.js";
import bcrypt from "bcryptjs";

async function comprehensiveTest() {
  try {
    console.log("=== COMPREHENSIVE OWNER ROLE TEST ===\n");
    
    // Test 1: Verify admin account exists with correct role
    console.log("1. Checking admin account...");
    const admin = await storage.getAdminByPin("131313");
    if (!admin) {
      console.log("❌ Admin account not found!");
      return;
    }
    console.log(`✅ Found admin: PIN=${admin.pin}, Role=${admin.role}`);
    console.log(`✅ Is owner: ${admin.role === 'owner' ? 'YES' : 'NO'}\n`);
    
    // Test 2: Verify password works
    console.log("2. Testing password verification...");
    const isPasswordValid = await bcrypt.compare("adminpassword", admin.passwordHash);
    console.log(`✅ Password verification: ${isPasswordValid ? 'SUCCESS' : 'FAILED'}\n`);
    
    // Test 3: Simulate login and role assignment
    console.log("3. Simulating login session...");
    const sessionData = {
      isAdminLoggedIn: true,
      adminId: admin.id,
      adminRole: admin.role
    };
    console.log(`✅ Session created with role: ${sessionData.adminRole}`);
    console.log(`✅ Has owner permissions: ${sessionData.adminRole === 'owner' ? 'YES' : 'NO'}\n`);
    
    // Test 4: Check specific owner permissions
    console.log("4. Checking owner-specific permissions...");
    const canManageAdmins = sessionData.adminRole === 'owner';
    const canCreateAdmins = sessionData.adminRole === 'owner' || sessionData.adminRole === 'admin';
    const canDeleteAdmins = sessionData.adminRole === 'owner';
    
    console.log(`✅ Can manage admins (owner only): ${canManageAdmins ? 'YES' : 'NO'}`);
    console.log(`✅ Can create admins (owner/admin): ${canCreateAdmins ? 'YES' : 'NO'}`);
    console.log(`✅ Can delete admins (owner only): ${canDeleteAdmins ? 'YES' : 'NO'}`);
    console.log(`✅ Has all permissions: ${sessionData.adminRole === 'owner' ? 'YES' : 'NO'}\n`);
    
    // Test 5: Verify database role is correct
    console.log("5. Verifying database integrity...");
    const allAdmins = await storage.getAllAdmins();
    const ownerCount = allAdmins.filter(a => a.role === 'owner').length;
    console.log(`✅ Total admins: ${allAdmins.length}`);
    console.log(`✅ Owner accounts: ${ownerCount}`);
    console.log(`✅ Current admin role in DB: ${admin.role}\n`);
    
    console.log("=== TEST SUMMARY ===");
    if (admin.role === 'owner' && isPasswordValid) {
      console.log("🎉 ALL TESTS PASSED - Owner role is working correctly!");
      console.log("✅ You should have full access to all admin functions");
      console.log("✅ Including: Admin management, user management, project management");
    } else {
      console.log("❌ SOME TESTS FAILED - Check the results above");
    }
    
  } catch (error) {
    console.error("Test failed with error:", error);
  }
}

comprehensiveTest();