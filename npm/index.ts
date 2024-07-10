import type { Handle } from '@sveltejs/kit';
import Redis from 'ioredis';
import { captureException } from '@sentry/sveltekit';

interface HeaderOptions {
  enabled: boolean;
  mustRevalidate: boolean;
  maxAge: number | null;
  sMaxAge: number | null;
  public: boolean;
  private: boolean;
  noCache: boolean;
  etagCacheKey: string;
  noCacheSearchParams: string[];
}

interface HandleOptions extends HeaderOptions {
  routes: string[];
  methods: string[];
}

const DEFAULT_HEADER_OPTIONS: HeaderOptions = {
  enabled: true,
  mustRevalidate: false,
  maxAge: 60,
  sMaxAge: null,
  public: true,
  private: false,
  noCache: false,
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
  response: Response | (() => Promise<Response> | Response) | null = null
) {
  const options = {
    ...DEFAULT_HEADER_OPTIONS,
    ...opt,
  };

  if (!redis) {
    initRedis(redisUrl);
  }

  const headers: Record<string, string> = {};

  if (
    !request.headers.has('Authorization') &&
    options.noCacheSearchParams.every(
      (param) => !new URL(request.url).searchParams.has(param)
    )
  ) {
    if (options.etagCacheKey && redis) {
      const etag = await redis.get(options.etagCacheKey);

      if (etag) {
        const requestEtag = request.headers.get('If-None-Match');
        if (requestEtag === etag) {
          return new Response(null, {
            status: 304,
            statusText: 'Not Modified',
          });
        }

        headers['ETag'] = etag;
      }
    }

    headers['Cache-Control'] = [
      options.private && 'private',
      options.public && 'public',
      options.maxAge !== null && `max-age=${options.maxAge}`,
      options.sMaxAge !== null && `s-maxage=${options.maxAge}`,
      options.mustRevalidate && 'must-revalidate',
    ]
      .filter(Boolean)
      .join(', ');
  }

  const resp = !response ? new Response() : typeof response === 'function' ? await response() : response;

  Object.entries(headers).forEach(([key, value]) => {
    resp.headers.set(key, value);
  });

  return resp;
}

export function cacheControlHandle(
  redisUrl: string,
  opt: Partial<HandleOptions>
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
    const response = await resolve(event);

    if (
      response.status === 200 &&
      options.methods.includes(event.request.method) &&
      options.routes.some((route) => new RegExp(route).test(event.url.pathname))
    ) {
      return await createCacheControlResponse(
        redisUrl,
        options,
        event.request,
        response,
      );
    }

    return response;
  };
}
