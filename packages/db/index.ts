import { drizzle } from "drizzle-orm/node-postgres";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schemas";

export interface DbEnv {
  DATABASE_URL?: string;
  HYPERDRIVE?: {
    connectionString: string;
  };
}

export type DbType = NodePgDatabase<typeof schema>;

export function getDb(env: DbEnv): DbType {
  const connectionString = env.HYPERDRIVE?.connectionString ?? env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      "Missing HYPERDRIVE binding or DATABASE_URL environment variable",
    );
  }

  const pool = new Pool({ connectionString, max: 1 });

  const db = drizzle(pool, { schema });

  return db;
}
