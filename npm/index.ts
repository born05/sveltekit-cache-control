import type { Handle } from '@sveltejs/kit';
import Redis from 'ioredis';
import { captureException } from '@sentry/sveltekit';

interface Options {
  enabled: boolean;
  mustRevalidate: boolean;
  maxAge: number;
  public: boolean;
  private: boolean;
  routes: string[];
  methods: string[];
  noCacheSearchParams: string[];
  etagCacheKey: string;
}

const DEFAULT_OPTIONS: Options = {
  enabled: true,
  mustRevalidate: false,
  maxAge: 60,
  public: true,
  private: false,
  routes: ['.*'],
  methods: ['GET'],
  noCacheSearchParams: ['preview'],
  etagCacheKey: 'cache-control-etag',
};

export function cacheControlHandle(
  redisUrl: string,
  opt: Partial<Options>
): Handle {
  const options = {
    ...DEFAULT_OPTIONS,
    ...opt,
  };

  if (!options.enabled) {
    return async ({ event, resolve }) => resolve(event);
  }

  const redis = new Redis(redisUrl);

  redis.on('error', (error) => {
    console.error(error);
    captureException(error);
  });

  redis.on('connect', () => {
    console.log('Redis connected');
  });

  return async function ({ event, resolve }) {
    const response = await resolve(event);

    if (
      options.enabled &&
      options.maxAge &&
      !event.request.headers.has('Authorization') &&
      options.methods.includes(event.request.method) &&
      response.status === 200 &&
      options.routes.some((route) =>
        new RegExp(route).test(event.url.pathname)
      ) &&
      options.noCacheSearchParams.every(
        (param) => !event.url.searchParams.has(param)
      )
    ) {
      response.headers.set(
        'Cache-Control',
        [
          !options.public && options.private && 'private',
          options.public && !options.private && 'public',
          `max-age=${options.maxAge}`,
          options.mustRevalidate && 'must-revalidate',
        ]
          .filter(Boolean)
          .join(', ')
      );

      if (options.etagCacheKey && redis) {
        const etag = await redis.get(options.etagCacheKey);

        if (etag) {
          response.headers.set('ETag', etag);

          const requestEtag = event.request.headers.get('If-None-Match');
          if (requestEtag === etag) {
            return new Response(null, {
              status: 304,
              statusText: 'Not Modified',
            });
          }
        }
      }
    }

    return response;
  } satisfies Handle;
}
