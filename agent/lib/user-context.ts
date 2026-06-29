import { AsyncLocalStorage } from 'node:async_hooks';

export interface UserContext {
  /** Slack user ID (e.g. "U07A1B2C3") when the message came via Slack. */
  userId?: string;
  /** Conversation/channel/thread ID. */
  conversationId?: string;
}

/**
 * Per-request user context. The Astropods adapter wrapper in agent/index.ts
 * sets this for the duration of each stream() call. Tools read from it via
 * getCurrentUser() to look up per-user credentials (e.g. Confluence tokens).
 */
export const userContextStorage = new AsyncLocalStorage<UserContext>();

export function getCurrentUser(): UserContext {
  return userContextStorage.getStore() ?? {};
}
