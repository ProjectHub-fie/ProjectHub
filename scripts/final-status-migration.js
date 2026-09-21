import { Client } from 'pg';

async function finalMigration() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false
    }
  });

  try {
    await client.connect();
    console.log('Connected to database');

    // Start transaction
    await client.query('BEGIN');

    try {
      console.log('Dropping default constraint...');
      // Drop the default value first
      await client.query('ALTER TABLE project_requests ALTER COLUMN status DROP DEFAULT;');
      
      console.log('Dropping NOT NULL constraint...');
      // Drop the NOT NULL constraint temporarily
      await client.query('ALTER TABLE project_requests ALTER COLUMN status DROP NOT NULL;');
      
      console.log('Setting all NULL status values to pending...');
      // Set all NULL status values to 'pending'
      await client.query("UPDATE project_requests SET status = 'pending' WHERE status IS NULL;");
      
      console.log('Dropping old enum type...');
      await client.query('DROP TYPE IF EXISTS project_request_status_old;');
      await client.query('ALTER TYPE project_request_status RENAME TO project_request_status_old;');
      
      console.log('Creating new enum...');
      await client.query(`
        CREATE TYPE project_request_status AS ENUM(
          'pending', 
          'working', 
          'done', 
          'canceled', 
          'suspended'
        );
      `);
      
      console.log('Altering column type...');
      await client.query(`
        ALTER TABLE project_requests 
        ALTER COLUMN status TYPE project_request_status 
        USING status::text::project_request_status;
      `);
      
      console.log('Setting new default...');
      await client.query(`
        ALTER TABLE project_requests 
        ALTER COLUMN status SET DEFAULT 'pending';
      `);
      
      console.log('Setting NOT NULL constraint...');
      await client.query(`
        ALTER TABLE project_requests 
        ALTER COLUMN status SET NOT NULL;
      `);
      
      console.log('Dropping old enum...');
      await client.query('DROP TYPE project_request_status_old;');
      
      // Commit transaction
      await client.query('COMMIT');
      console.log('Migration completed successfully!');

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }

    // Verify the changes
    console.log('\n=== Verification ===');
    const result = await client.query(`
      SELECT enumlabel 
      FROM pg_enum 
      WHERE enumtypid = (
        SELECT oid 
        FROM pg_type 
        WHERE typname = 'project_request_status'
      )
      ORDER BY enumsortorder;
    `);
    
    console.log('New project_request_status enum values:');
    result.rows.forEach((row, index) => {
      console.log(`  ${index + 1}. ${row.enumlabel}`);
    });

    // Check if there are any records and their status
    console.log('\nChecking project requests:');
    const requests = await client.query('SELECT COUNT(*) as count FROM project_requests;');
    console.log(`Total project requests: ${requests.rows[0].count}`);
    
    if (requests.rows[0].count > 0) {
      const sample = await client.query('SELECT id, title, status FROM project_requests LIMIT 3;');
      console.log('Sample records:');
      sample.rows.forEach(row => {
        console.log(`  ${row.id}: "${row.title}" - Status: ${row.status}`);
      });
    }

  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    await client.end();
  }
}

finalMigration();