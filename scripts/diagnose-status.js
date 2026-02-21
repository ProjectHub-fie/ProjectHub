import { Client } from 'pg';

async function diagnoseStatus() {
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

    // Check actual status values in the table
    console.log('\n=== Actual Status Values in Table ===');
    const statusValues = await client.query(`
      SELECT DISTINCT status, COUNT(*) as count
      FROM project_requests
      GROUP BY status
      ORDER BY status;
    `);
    
    console.log('Current status values in project_requests:');
    statusValues.rows.forEach(row => {
      console.log(`  - ${row.status}: ${row.count} records`);
    });

    // Check table structure
    console.log('\n=== Table Column Info ===');
    const columnInfo = await client.query(`
      SELECT column_name, data_type, column_default, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'project_requests' AND column_name = 'status';
    `);
    
    console.log('Status column info:');
    columnInfo.rows.forEach(row => {
      console.log(`  Column: ${row.column_name}`);
      console.log(`  Type: ${row.data_type}`);
      console.log(`  Default: ${row.column_default}`);
      console.log(`  Nullable: ${row.is_nullable}`);
    });

  } catch (error) {
    console.error('Diagnosis failed:', error);
  } finally {
    await client.end();
  }
}

diagnoseStatus();