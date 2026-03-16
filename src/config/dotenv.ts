import dotenv from 'dotenv';

const result = dotenv.config();
if (result.error) {
  console.warn(`[env] Warning: Failed to load .env file: ${result.error.message}`);
}
