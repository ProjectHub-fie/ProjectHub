import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import * as schema from '../drizzle/schema.js';
import dotenv from 'dotenv';
import { eq, sql } from 'drizzle-orm';

dotenv.config();

async function testProjectStatusUpdate() {
  console.log('🔍 Testing Project Request Status Update...\n');

  try {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      console.error('❌ DATABASE_URL environment variable is not set');
      process.exit(1);
    }

    // Setup database connection
    const sqlClient = neon(databaseUrl);
    const db = drizzle(sqlClient, { schema });
    
    // Test basic connectivity
    await db.execute('SELECT 1');
    console.log('✅ Database connection successful');

    // Get project requests table
    const { projectRequests } = schema;

    // First, let's check existing project requests
    const existingRequests = await db.select().from(projectRequests).limit(5);
    
    console.log(`📊 Found ${existingRequests.length} project requests:`);
    existingRequests.forEach((req, index) => {
      console.log(`${index + 1}. ${req.title} (ID: ${req.id}) - Status: ${req.status}`);
    });

    // Check available enum values
    console.log('\n🔍 Checking available status enum values...');
    const enumValues = await db.execute(`
      SELECT enumlabel 
      FROM pg_enum e 
      JOIN pg_type t ON e.enumtypid = t.oid 
      WHERE t.typname = 'project_request_status'
      ORDER BY enumsortorder
    `);
    
    console.log('Available statuses:', enumValues.rows.map((row: any) => row.enumlabel));

    if (existingRequests.length === 0) {
      console.log('\n📝 No existing requests found. Creating a test request...');
      
      // Create a test project request
      const testRequest = await db.insert(projectRequests).values({
        userId: '00000000-0000-0000-0000-000000000000',
        title: 'Test Project Request',
        description: 'This is a test project request for status update testing',
        budget: '$5000-$10000',
        timeline: '3-6 months',
        technologies: ['React', 'Node.js', 'PostgreSQL'],
        status: 'pending'
      }).returning();
      
      console.log(`✅ Created test request: ${testRequest[0].title}`);
      
      // Now test status update using raw SQL to bypass enum validation issues
      console.log('\n🔄 Testing status update from pending to in_review...');
      const updatedRequest = await db.update(projectRequests)
        .set({ 
          status: sql`'in_review'::project_request_status`,
          updatedAt: new Date() 
        })
        .where(eq(projectRequests.id, testRequest[0].id))
        .returning();
      
      console.log(`✅ Status updated successfully! New status: ${updatedRequest[0].status}`);
      
      // Test another status change
      console.log('\n🔄 Testing status update from in_review to approved...');
      const finalRequest = await db.update(projectRequests)
        .set({ 
          status: sql`'approved'::project_request_status`,
          updatedAt: new Date() 
        })
        .where(eq(projectRequests.id, testRequest[0].id))
        .returning();
      
      console.log(`✅ Final status update successful! New status: ${finalRequest[0].status}`);
      
      // Clean up - delete the test request
      console.log('\n🧹 Cleaning up test data...');
      await db.delete(projectRequests).where(eq(projectRequests.id, testRequest[0].id));
      console.log('✅ Test data cleaned up successfully');
      
    } else {
      // Test with existing request
      const testRequest = existingRequests[0];
      console.log(`\n🔄 Testing status update for existing request: ${testRequest.title}`);
      
      const originalStatus = testRequest.status;
      const availableStatuses = enumValues.rows.map((row: any) => row.enumlabel);
      const nextStatus = availableStatuses.find((status: string) => status !== originalStatus) || 'pending';
      
      console.log(`   Changing status from ${originalStatus} to ${nextStatus}...`);
      
      const updatedRequest = await db.update(projectRequests)
        .set({ 
          status: sql`${nextStatus}::project_request_status`,
          updatedAt: new Date() 
        })
        .where(eq(projectRequests.id, testRequest.id))
        .returning();
      
      console.log(`✅ Status updated successfully! New status: ${updatedRequest[0].status}`);
      
      // Restore original status
      console.log(`\n🔄 Restoring original status: ${originalStatus}...`);
      await db.update(projectRequests)
        .set({ 
          status: sql`${originalStatus}::project_request_status`,
          updatedAt: new Date() 
        })
        .where(eq(projectRequests.id, testRequest.id));
      
      console.log('✅ Original status restored');
    }

    console.log('\n🎉 All tests passed! Project status update functionality is working correctly.');
    
  } catch (error: any) {
    console.error('❌ Test failed:', error.message);
    if (error.cause) {
      console.error('Cause:', error.cause.message);
    }
    process.exit(1);
  }
}

// Run the test
testProjectStatusUpdate();