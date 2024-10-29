import type { Handle } from '@sveltejs/kit';
import Redis from 'ioredis';
import { captureException } from '@sentry/sveltekit';

const CACHE_STRATEGY_PRIVATE_ONLY = 'private-only';
const CACHE_STRATEGY_PRIVATE_AND_PUBLIC = 'private-and-public';
const CACHE_STRATEGY_FORCE_PUBLIC = 'force-public';
const CACHE_STRATEGY_NO_CACHE = 'no-cache';

type CacheStrategy =
  | typeof CACHE_STRATEGY_PRIVATE_ONLY
  | typeof CACHE_STRATEGY_PRIVATE_AND_PUBLIC
  | typeof CACHE_STRATEGY_FORCE_PUBLIC
  | typeof CACHE_STRATEGY_NO_CACHE;

interface HeaderOptions {
  enabled: boolean;
  maxAge: number | null;
  sMaxAge: number | null;
  strategy: CacheStrategy;
  etagCacheKey: string;
  noCacheSearchParams: string[];
}

interface HandleOptions extends HeaderOptions {
  routes: string[];
  methods: string[];
}

const DEFAULT_HEADER_OPTIONS: HeaderOptions = {
  enabled: true,
  maxAge: 60,
  sMaxAge: null,
  strategy: CACHE_STRATEGY_PRIVATE_AND_PUBLIC,
  etagCacheKey: 'cache-control-etag',
  noCacheSearchParams: ['preview'],
};

const DEFAULT_HANDLE_OPTIONS: HandleOptions = {
  ...DEFAULT_HEADER_OPTIONS,
  routes: ['.*'],
  methods: ['GET'],
};

let redis: Redis | null = null;

if (process.env.REDIS_URL) {
  initRedis(process.env.REDIS_URL);
}

function initRedis(redisUrl: string) {
  redis = new Redis(redisUrl);

  redis.on('error', (error) => {
    console.error(error);
    captureException(error);
  });

  redis.on('connect', () => {
    console.log('Redis connected');
  });
}

export async function createCacheControlResponse(
  redisUrl: string,
  opt: Partial<HeaderOptions>,
  request: Request,
  response: Response | (() => Response | Promise<Response>) | null = null,
) {
  const options = {
    ...DEFAULT_HEADER_OPTIONS,
    ...opt,
  };

  const headers: Record<string, string> = {};

  if (options.enabled) {
    if (!redis) {
      initRedis(redisUrl);
    }

    if (
      options.noCacheSearchParams.every(
        (param) => !new URL(request.url).searchParams.has(param),
      )
    ) {
      const joinParts = (p: (string | null | undefined | boolean)[]) =>
        p.filter(Boolean).join(', ');

      // Private only cache control
      if (
        options.strategy === CACHE_STRATEGY_PRIVATE_ONLY ||
        (options.strategy === CACHE_STRATEGY_PRIVATE_AND_PUBLIC &&
          request.headers.has('Authorization'))
      ) {
        headers['Cache-Control'] = joinParts([
          'private',
          options.maxAge !== null && `max-age=${options.maxAge}`,
        ]);
      }
      // Private and public cache control (default)
      else if (options.strategy === CACHE_STRATEGY_PRIVATE_AND_PUBLIC) {
        headers['Cache-Control'] = joinParts([
          options.maxAge !== null && `max-age=${options.maxAge}`,
          options.sMaxAge !== null && `s-maxage=${options.sMaxAge}`,
        ]);
      }
      // Force public cache control
      else if (options.strategy === CACHE_STRATEGY_FORCE_PUBLIC) {
        headers['Cache-Control'] = joinParts([
          'public',
          options.maxAge !== null && `max-age=${options.maxAge}`,
          options.sMaxAge !== null && `s-maxage=${options.sMaxAge}`,
        ]);
      }
      // No cache control
      else if (options.strategy === CACHE_STRATEGY_NO_CACHE) {
        headers['Cache-Control'] = 'no-cache';
      }

      if (options.etagCacheKey && redis) {
        const etag = await redis.get(options.etagCacheKey);

        if (etag) {
          headers.ETag = etag;

          const requestEtag = request.headers.get('If-None-Match');
          if (requestEtag === etag) {
            return new Response(null, {
              status: 304,
              statusText: 'Not Modified',
              headers,
            });
          }
        }
      }
    }
  }

  const resp = !response
    ? new Response()
    : typeof response === 'function'
      ? await response()
      : response;

  if (resp.status !== 200) return resp;

  Object.entries(headers).forEach(([key, value]) => {
    resp.headers.set(key, value);
  });

  return resp;
}

export function cacheControlHandle(
  redisUrl: string,
  opt: Partial<HandleOptions>,
): Handle {
  const options = {
    ...DEFAULT_HANDLE_OPTIONS,
    ...opt,
  };

  if (!options.enabled) {
    return async ({ event, resolve }) => resolve(event);
  }

  if (!redis) {
    initRedis(redisUrl);
  }

  return async ({ event, resolve }) => {
    if (
      options.methods.includes(event.request.method) &&
      options.routes.some((route) => new RegExp(route).test(event.url.pathname))
    ) {
      return await createCacheControlResponse(
        redisUrl,
        options,
        event.request,
        () => resolve(event),
      );
    }

    return resolve(event);
  };
}
