import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/core/db/schema/index.ts',
  out: './src/core/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
