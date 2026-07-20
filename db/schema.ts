import { sql } from "drizzle-orm";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";

export const atlasState = sqliteTable("atlas_state", {
  id: text("id").primaryKey(),
  payload: text("payload").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
