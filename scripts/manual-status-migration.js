import { Client } from 'pg';

async function manualMigration() {
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
      console.log('Mapping existing status values...');
      
      // Map existing values to new ones
      await client.query(`
        UPDATE project_requests 
        SET status = CASE 
          WHEN status = 'pending' THEN 'pending'
          WHEN status = 'approved' THEN 'done'
          WHEN status = 'rejected' THEN 'canceled'
          WHEN status = 'in-progress' THEN 'working'
          WHEN status = 'completed' THEN 'done'
          ELSE 'pending'
        END
        WHERE status IN ('pending', 'approved', 'rejected', 'in-progress', 'completed');
      `);

      console.log('Dropping old enum type...');
      await client.query('DROP TYPE IF EXISTS project_request_status_old;');
      
      console.log('Renaming current enum to old...');
      await client.query('ALTER TYPE project_request_status RENAME TO project_request_status_old;');
      
      console.log('Creating new enum with updated values...');
      await client.query(`
        CREATE TYPE project_request_status AS ENUM(
          'pending', 
          'working', 
          'done', 
          'canceled', 
          'suspended'
        );
      `);
      
      console.log('Altering table to use new enum...');
      await client.query(`
        ALTER TABLE project_requests 
        ALTER COLUMN status TYPE project_request_status 
        USING status::text::project_request_status;
      `);
      
      console.log('Dropping old enum...');
      await client.query('DROP TYPE project_request_status_old;');
      
      console.log('Setting default value...');
      await client.query(`
        ALTER TABLE project_requests 
        ALTER COLUMN status SET DEFAULT 'pending';
      `);
      
      // Commit transaction
      await client.query('COMMIT');
      console.log('Migration completed successfully!');

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }

    // Verify the changes
    console.log('\nVerifying enum values:');
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
    
    console.log('Current project_request_status enum values:');
    result.rows.forEach(row => {
      console.log(`  - ${row.enumlabel}`);
    });

  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    await client.end();
  }
}

manualMigration();