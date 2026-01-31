import { db } from '../server/db.js';
import { adminCredentials, sessions } from '../drizzle/schema.js';
import { eq } from 'drizzle-orm';

async function checkDatabaseHealth() {
  console.log('🔍 Checking database health...');
  
  try {
    // Test basic connection by running a simple query
    console.log('🔌 Testing database connection...');
    const result = await db.select().from(adminCredentials).limit(1);
    console.log('✅ Database connection successful');
    
    // Check if admin credentials table has records
    console.log('📋 Checking for admin accounts...');
    const admins = await db.select().from(adminCredentials);
    console.log(`👥 Found ${admins.length} admin accounts`);
    
    if (admins.length === 0) {
      console.log('⚠️  No admin accounts found. You need to create an admin account.');
      console.log('💡 Run: DATABASE_URL="your_db_url" npx tsx scripts/create-admin.ts');
    } else {
      console.log('✅ At least one admin account exists');
      admins.forEach(admin => {
        console.log(`   - Admin PIN: ${admin.pin}, Updated: ${admin.updatedAt}`);
      });
    }
    
    // Check if sessions table exists by attempting a simple query
    console.log('🔄 Checking sessions table...');
    try {
      await db.select().from(sessions).limit(1);
      console.log('✅ Sessions table exists and is accessible');
    } catch (error) {
      console.log('❌ Sessions table may not exist:', (error as Error).message);
    }
    
    console.log('\n✅ Database health check completed successfully');
    
  } catch (error) {
    console.error('❌ Database health check failed:', (error as Error).message);
    
    if ((error as Error).message.includes("DATABASE_URL must be set")) {
      console.log('\n🔧 Please ensure your DATABASE_URL environment variable is properly set.');
      console.log('   Example: postgresql://username:password@host:port/database_name');
    } else if ((error as Error).message.includes("password authentication failed")) {
      console.log('\n🔐 Authentication failed. Please check your database credentials.');
    } else if ((error as Error).message.includes("database") && (error as Error).message.includes("does not exist")) {
      console.log('\n📁 Database does not exist. Please create your database first.');
    } else if ((error as Error).message.includes("getaddrinfo ENOTFOUND")) {
      console.log('\n🌐 Host not found. Please check your database host configuration.');
    } else {
      console.log('\n📋 Full error details:', error);
    }
    
    process.exit(1);
  }
}

checkDatabaseHealth();