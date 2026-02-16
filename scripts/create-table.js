// Manual table creation script
import postgres from 'postgres';

async function createVerifiedProjectsTable() {
  const databaseUrl = process.env.DATABASE_URL;
  
  if (!databaseUrl) {
    console.error('DATABASE_URL not set');
    process.exit(1);
  }

  const client = postgres(databaseUrl, {
    ssl: { rejectUnauthorized: false },
    max: 1,
  });

  try {
    console.log('Creating verified_projects table...');
    
    // Check if table exists first
    const tableExists = await client`
      SELECT EXISTS (
        SELECT 1 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'verified_projects'
      )
    `;
    
    if (tableExists[0].exists) {
      console.log('verified_projects table already exists');
      return;
    }
    
    // Create the table
    await client`
      CREATE TABLE verified_projects (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        slug text NOT NULL UNIQUE,
        title text NOT NULL,
        description text NOT NULL,
        long_description text,
        image_url text,
        category text NOT NULL,
        technologies text[],
        features text[],
        highlights text[],
        live_url text,
        github_url text,
        status text NOT NULL,
        author_name text,
        author_avatar text,
        architecture text,
        timeline text,
        team_size text,
        user_count text,
        is_active boolean DEFAULT true,
        sort_order integer DEFAULT 0,
        created_at timestamp DEFAULT now(),
        updated_at timestamp DEFAULT now()
      )
    `;
    
    console.log('✓ verified_projects table created successfully');
    
    // Add some sample data
    console.log('Adding sample projects...');
    await client`
      INSERT INTO verified_projects (
        slug, title, description, long_description, category, status, is_active, sort_order
      ) VALUES 
      ('primebot', 'PrimeBot', 'Advanced Discord bot with giveaway system', 'Full featured Discord bot', 'bots', 'active', true, 1),
      ('webhost', 'WebHost', 'Modern web hosting platform', 'Enterprise web hosting solution', 'websites', 'developing', true, 2)
    `;
    
    console.log('✓ Sample data added');
    
  } catch (error) {
    console.error('Error creating table:', error.message);
  } finally {
    await client.end();
  }
}

createVerifiedProjectsTable();