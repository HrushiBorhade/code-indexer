import { relations } from 'drizzle-orm';
import {
  user,
  session,
  account,
  repos,
  fileHashes,
  chunkCache,
  dirHashes,
  conversations,
  messages,
  indexJobs,
} from './schema';

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
  repos: many(repos),
  conversations: many(conversations),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, { fields: [session.userId], references: [user.id] }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, { fields: [account.userId], references: [user.id] }),
}));

export const reposRelations = relations(repos, ({ one, many }) => ({
  user: one(user, { fields: [repos.userId], references: [user.id] }),
  fileHashes: many(fileHashes),
  chunkCache: many(chunkCache),
  dirHashes: many(dirHashes),
  conversations: many(conversations),
  indexJobs: many(indexJobs),
}));

export const fileHashesRelations = relations(fileHashes, ({ one }) => ({
  repo: one(repos, { fields: [fileHashes.repoId], references: [repos.id] }),
}));

export const chunkCacheRelations = relations(chunkCache, ({ one }) => ({
  repo: one(repos, { fields: [chunkCache.repoId], references: [repos.id] }),
}));

export const dirHashesRelations = relations(dirHashes, ({ one }) => ({
  repo: one(repos, { fields: [dirHashes.repoId], references: [repos.id] }),
}));

export const conversationsRelations = relations(conversations, ({ one, many }) => ({
  repo: one(repos, { fields: [conversations.repoId], references: [repos.id] }),
  user: one(user, { fields: [conversations.userId], references: [user.id] }),
  messages: many(messages),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  conversation: one(conversations, {
    fields: [messages.conversationId],
    references: [conversations.id],
  }),
}));

export const indexJobsRelations = relations(indexJobs, ({ one }) => ({
  repo: one(repos, { fields: [indexJobs.repoId], references: [repos.id] }),
}));
