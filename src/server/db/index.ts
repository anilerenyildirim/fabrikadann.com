import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as tables from "./schema";
import * as relations from "./relations";

const schema = { ...tables, ...relations };

export type Db = NodePgDatabase<Schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbOrTx = Db | Tx;

// Geliştirmede sıcak yeniden yüklemede bağlantı havuzu çoğalmasın
const globalForDb = globalThis as unknown as { pgPool?: Pool };

function createPool() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL tanımlı değil");
  return new Pool({ connectionString: url, max: 10 });
}

export const pool = globalForDb.pgPool ?? createPool();
if (process.env.NODE_ENV !== "production") globalForDb.pgPool = pool;

export const db: Db = drizzle(pool, { schema });
export { tables as schema };
export type Schema = typeof schema;
