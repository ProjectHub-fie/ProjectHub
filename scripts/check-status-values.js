import { Client } from 'pg';

async function checkStatusValues() {
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
    console.log('\nCurrent project_request_status enum values:');
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
    
    enumResult.rows.forEach(row => {
      console.log(`  - ${row.enumlabel}`);
    });

    // Check current records
    console.log('\nSample project requests:');
    const requestsResult = await client.query(`
      SELECT id, title, status, created_at 
      FROM project_requests 
      LIMIT 5;
    `);
    
    requestsResult.rows.forEach(row => {
      console.log(`  ${row.id}: "${row.title}" - Status: ${row.status}`);
    });

  } catch (error) {
    console.error('Check failed:', error);
  } finally {
    await client.end();
  }
}

checkStatusValues();