import { Client } from 'pg';

async function testStatusDisplay() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false
    }
  });

  try {
    await client.connect();
    console.log('Connected to database');

    // Check current enum values
    console.log('\n=== Current Enum Values ===');
    const enumResult = await client.query(`
      SELECT enumlabel 
      FROM pg_enum 
      WHERE enumtypid = (
        SELECT oid 
        FROM pg_type 
        WHERE typname = 'project_request_status'
      )
      ORDER BY enumsortorder;
    `);
    
    console.log('project_request_status enum values:');
    enumResult.rows.forEach((row, index) => {
      console.log(`  ${index + 1}. ${row.enumlabel}`);
    });

    // Check actual project requests and their status
    console.log('\n=== Project Requests ===');
    const requests = await client.query(`
      SELECT id, title, status, created_at 
      FROM project_requests 
      ORDER BY created_at DESC 
      LIMIT 10;
    `);
    
    console.log('Project requests with status:');
    requests.rows.forEach((row, index) => {
      console.log(`${index + 1}. ID: ${row.id}`);
      console.log(`   Title: ${row.title}`);
      console.log(`   Status: ${row.status}`);
      console.log(`   Created: ${row.created_at}`);
      
      // Test emoji mapping
      const statusMap = {
        'pending': '🟠 Pending',
        'working': '🟡 Working', 
        'done': '🟢 Done',
        'canceled': '🔴 Canceled',
        'suspended': '🔴 Suspended'
      };
      
      const displayText = statusMap[row.status] || `❓ Unknown (${row.status})`;
      console.log(`   Display: ${displayText}`);
      console.log('');
    });

    if (requests.rows.length === 0) {
      console.log('No project requests found in database');
    }

  } catch (error) {
    console.error('Test failed:', error);
  } finally {
    await client.end();
  }
}

testStatusDisplay();