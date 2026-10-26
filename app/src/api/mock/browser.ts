/**
 * Starts the in-browser mock engine (MSW handlers + simulated SSE).
 * Loaded dynamically from bootstrap only when VITE_MOCK=1, so it is split out of normal builds.
 *
 * Preferred transport is the MSW service worker. Where service workers are unavailable
 * (some embedded WebViews, file:// or insecure origins), it falls back to patching window.fetch
 * and answering engine requests in-page with the same handlers via MSW's getResponse().
 */
import { getResponse } from 'msw';
import { setupWorker } from 'msw/browser';
import { getEngineInfo } from '../engine';
import { setEventSourceFactory } from '../events';
import { MockEventSource } from './eventBus';
import { handlers } from './handlers';

function installFetchFallback() {
  const original = window.fetch.bind(window);
  const base = getEngineInfo().url;
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    if (!request.url.startsWith(base)) return original(input, init);
    const response = await getResponse(handlers, request);
    return response ?? new Response(null, { status: 404 });
  };
}

export async function startMockEngine(): Promise<'service-worker' | 'fetch-patch'> {
  setEventSourceFactory((url) => new MockEventSource(url));
  if ('serviceWorker' in navigator) {
    try {
      const worker = setupWorker(...handlers);
      await worker.start({
        serviceWorker: { url: `${import.meta.env.BASE_URL}mockServiceWorker.js` },
        onUnhandledRequest: 'bypass',
        quiet: true,
      });
      return 'service-worker';
    } catch (e) {
      console.info('[mock] service worker unavailable, using in-page fetch mock', e);
    }
  }
  installFetchFallback();
  return 'fetch-patch';
}
