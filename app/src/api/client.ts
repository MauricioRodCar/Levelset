import createClient, { type Client, type Middleware } from 'openapi-fetch';
import { getEngineInfo } from './engine';
import type { paths } from './schema';

/** Error thrown by API hooks. `code` is the engine's stable Problem.code (translate via errors:codes.*). */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string | undefined,
    public detail: string | undefined,
    public title?: string,
  ) {
    super(title || detail || `HTTP ${status}`);
    this.name = 'ApiError';
  }
}

/** True when the engine could not be reached at all (offline / not started). */
export function isNetworkError(e: unknown): boolean {
  return e instanceof TypeError || (e instanceof ApiError && e.status === 0);
}

const auth: Middleware = {
  onRequest({ request }) {
    request.headers.set('Authorization', `Bearer ${getEngineInfo().token}`);
    return request;
  },
};

let cached: { url: string; client: Client<paths> } | null = null;

/**
 * Typed client generated from docs/api/openapi.yaml (`npm run api:types`).
 * Re-created if the engine URL changes (get_engine_info resolves before first render).
 */
export function getApi(): Client<paths> {
  const { url } = getEngineInfo();
  if (!cached || cached.url !== url) {
    const client = createClient<paths>({
      baseUrl: url,
      fetch: (r: Request) => globalThis.fetch(r),
    });
    client.use(auth);
    cached = { url, client };
  }
  return cached.client;
}

type FetchResult<T> = { data?: T; error?: unknown; response: Response };

/** Unwrap an openapi-fetch result: return data or throw ApiError with the Problem fields. */
export async function unwrap<T>(p: Promise<FetchResult<T>>): Promise<T> {
  const { data, error, response } = await p;
  if (!response.ok) {
    const prob = (error ?? {}) as { title?: string; detail?: string; code?: string };
    throw new ApiError(response.status, prob.code, prob.detail, prob.title);
  }
  return data as T;
}
