import type { Handle } from '@sveltejs/kit';
import { dev } from '$app/environment';
import Redis from 'ioredis';
import { captureException } from '@sentry/sveltekit';

interface Options {
  enabled: boolean; // default: true
  mustRevalidate: boolean; // default: true
  maxAge: number; // default: 0
  public: boolean; // default: true
  private: boolean; // default: true
  routes: string[]; // default: ['*']
  methods: string[]; // default: ['GET']
  noCacheSearchParams: string[]; // default: ['preview']
  etagCacheKey: string;
}

const DEFAULT_OPTIONS: Options = {
  enabled: !dev,
  mustRevalidate: true,
  maxAge: 60,
  public: true,
  private: true,
  routes: ['*.'],
  methods: ['GET'],
  noCacheSearchParams: ['preview'],
  etagCacheKey: '',
};

export function cacheControlHandle(
  redisUrl: string,
  opt: Partial<Options>
): Handle {
  const options = {
    ...DEFAULT_OPTIONS,
    ...opt,
  };

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
      options.methods.includes(event.request.method) &&
      response.status === 200 &&
      options.routes.some((route) =>
        new RegExp(route).test(event.url.toString())
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
          options.mustRevalidate && 'must-revalidate',
          `max-age=${options.maxAge}`,
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
