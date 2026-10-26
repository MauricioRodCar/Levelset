/**
 * MSW node server for tests, using the same handlers as the browser demo.
 * Call `setupMockServer()` at the top of a test file.
 */
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { setEventSourceFactory } from '@/api/events';
import { MockEventSource, handlers, mockConfig, resetMockDb } from '@/api/mock';

export const server = setupServer(...handlers);

export function setupMockServer() {
  beforeAll(() => {
    mockConfig.latencyMs = 0;
    mockConfig.stepDelayMs = 5;
    setEventSourceFactory((url) => new MockEventSource(url));
    server.listen({ onUnhandledRequest: 'error' });
  });
  afterEach(() => {
    server.resetHandlers();
    resetMockDb();
  });
  afterAll(() => server.close());
}
