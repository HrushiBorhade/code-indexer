import { betterAuth } from 'better-auth';
import { admin } from 'better-auth/plugins';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { createDb } from '@codeindexer/db/client';
import * as schema from '@codeindexer/db/schema';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
if (!process.env.BETTER_AUTH_SECRET) throw new Error('BETTER_AUTH_SECRET is required');
if (!process.env.BETTER_AUTH_URL) throw new Error('BETTER_AUTH_URL is required');
if (!process.env.GITHUB_CLIENT_ID) throw new Error('GITHUB_CLIENT_ID is required');
if (!process.env.GITHUB_CLIENT_SECRET) throw new Error('GITHUB_CLIENT_SECRET is required');

const db = createDb(process.env.DATABASE_URL);

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: 'pg', schema }),
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,

  socialProviders: {
    github: {
      clientId: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
    },
  },

  plugins: [
    admin({
      defaultRole: 'user',
      adminRoles: ['admin'],
    }),
  ],

  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60,
    },
  },

  trustedOrigins: [process.env.BETTER_AUTH_URL],

  advanced: {
    cookiePrefix: 'codeindexer',
    defaultCookieAttributes: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    },
  },
});

export type Session = typeof auth.$Infer.Session;
