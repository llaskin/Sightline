import { config } from 'dotenv';

/** Same precedence as the application: `.env.local` first, then `.env`. */
config({ path: '.env.local', quiet: true });
config({ path: '.env', quiet: true });
