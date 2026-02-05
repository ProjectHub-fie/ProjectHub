import postgres from 'postgres';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

console.log("Testing database connection...");
console.log("DATABASE_URL:", databaseUrl.substring(0, 50) + "...");

const client = postgres(databaseUrl, {
  ssl: { rejectUnauthorized: false },
  max: 1,
});

try {
  const result = await client`SELECT 1 as test`;
  console.log("Database connection successful:", result);
  await client.end();
  process.exit(0);
} catch (error) {
  console.error("Database connection failed:", error.message);
  process.exit(1);
}