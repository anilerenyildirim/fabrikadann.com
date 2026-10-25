import "dotenv/config";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

// Canlıda migration sahip rolle çalışır (uygulamanın rolü şema değiştiremez)
const url = process.argv.includes("--test")
  ? process.env.TEST_DATABASE_URL
  : (process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL);
const pool = new Pool({ connectionString: url });
await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
await pool.end();
console.log("Migration tamam:", new URL(url!).pathname.slice(1));
