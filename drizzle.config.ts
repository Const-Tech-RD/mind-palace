import { defineConfig } from 'drizzle-kit'

// Only used by `npm run db:generate` to turn src/main/db/schema.ts into SQL
// migrations under ./drizzle. The app applies those files itself at start.
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/main/db/schema.ts',
  out: './drizzle'
})
