import { getConnectionString } from "@netlify/database";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

let database: ReturnType<typeof drizzle<typeof schema>> | undefined;

export function getDb() {
  if (!database) {
    const connectionString = process.env.DATABASE_URL || getConnectionString();
    if (!connectionString) throw new Error("База данных KapaniGPT пока не подключена.");
    const pool = new pg.Pool({ connectionString, max: 4, idleTimeoutMillis: 15000 });
    database = drizzle(pool, { schema });
  }
  return database;
}
