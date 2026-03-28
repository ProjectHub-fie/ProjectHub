import 'dotenv/config';
import postgres from 'postgres';

async function check() {
  const client = postgres(process.env.DATABASE_URL!, { ssl: { rejectUnauthorized: false }, max: 1 });
  try {
    const tables = await client`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`;
    console.log('Tables:', tables.map(r => r.table_name).join(', '));
    
    const cols = await client`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'verified_projects' ORDER BY ordinal_position`;
    if (cols.length > 0) {
      console.log('verified_projects columns:', cols.map(c => `${c.column_name}(${c.data_type})`).join(', '));
    } else {
      console.log('verified_projects table does NOT exist');
    }

    const enums = await client`SELECT typname, enumlabel FROM pg_type JOIN pg_enum ON pg_type.oid = pg_enum.enumtypid ORDER BY typname, enumsortorder`;
    console.log('Enums:', enums.map(e => `${e.typname}:${e.enumlabel}`).join(', '));
  } catch(e: any) {
    console.error('Error:', e.message);
  }
  await client.end();
}

check();
