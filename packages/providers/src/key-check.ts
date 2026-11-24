/**
 * How a key check is sent. Someone is watching a spinner while it runs, so it
 * waits far less than a request for an answer does, and tries again once at
 * most.
 */
export const KEY_CHECK_TIMEOUT_MS = 10_000;
export const KEY_CHECK_MAX_RETRIES = 1;
