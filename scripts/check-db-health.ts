import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from '../drizzle/schema.js';
import dotenv from 'dotenv';

dotenv.config();

async function checkHealth() {
  try {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      console.error('❌ DATABASE_URL environment variable is not set');
      process.exit(1);
    }

    // Test database connection
    console.log('🔍 Testing database connection...');
    const sql = neon(databaseUrl);
    const db = drizzle(sql, { schema });
    
    // Test basic connectivity
    await db.execute('SELECT 1');
    console.log('✅ Database connection successful');

    // Check if sessions table exists
    console.log('🔍 Checking for sessions table...');
    const result = await db.execute(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'sessions'
      );
    `);
    
    // The result is returned differently depending on the driver
    const exists = Array.isArray(result) && result.length > 0 ? 
      result[0].exists : 
      (typeof result === 'object' && 'exists' in result ? result.exists : true);
    
    if (exists) {
      console.log('✅ Sessions table exists');
    } else {
      console.log('⚠️ Sessions table does not exist. Creating...');
      // Create sessions table manually
      await db.execute(`
        CREATE TABLE IF NOT EXISTS sessions (
          sid VARCHAR NOT NULL PRIMARY KEY,
          sess JSONB NOT NULL,
          expire TIMESTAMP(6) NOT NULL
        );
        
        CREATE INDEX IF NOT EXISTS IDX_session_expire ON sessions (expire);
      `);
      console.log('✅ Sessions table created successfully');
    }

    // Check if admin_credentials table exists
    console.log('🔍 Checking for admin_credentials table...');
    const adminExists = await db.execute(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'admin_credentials'
      );
    `);
    
    const adminTableExists = Array.isArray(adminExists) && adminExists.length > 0 ? 
      adminExists[0].exists : 
      (typeof adminExists === 'object' && 'exists' in adminExists ? adminExists.exists : true);
    
    if (adminTableExists) {
      console.log('✅ Admin credentials table exists');
      
      // Check if any admin accounts exist
      const adminCountResult = await db.execute('SELECT COUNT(*) AS count FROM admin_credentials');
      const adminCount = Array.isArray(adminCountResult) && adminCountResult.length > 0 ?
        parseInt(adminCountResult[0].count, 10) :
        0;
      
      console.log(`👥 Found ${adminCount} admin account(s)`);
      
      if (adminCount === 0) {
        console.warn('⚠️ No admin accounts found. You may need to create an admin account.');
      }
    } else {
      console.error('❌ Admin credentials table does not exist. Run database migrations.');
    }

    console.log('\n🎉 Health check completed successfully!');
    console.log('\n📋 Summary:');
    console.log('- Database connection: ✅ Working');
    console.log('- Sessions table: ✅ ' + (exists ? 'Present' : 'Created'));
    console.log('- Admin credentials table: ' + (adminTableExists ? '✅ Present' : '❌ Missing'));
    
  } catch (error) {
    console.error('❌ Health check failed:', error);
    process.exit(1);
  }
}

checkHealth();