# SvelteKit Cache Control

A simple way to add control caching in your SvelteKit project.

Install:

```
npm i -D @born05/sveltekit-cache-control
```

Example usage:

```ts
import { sequence } from '@sveltejs/kit/hooks';
import type { Handle } from '@sveltejs/kit';
import { proxyHandle } from '@born05/sveltekit-cache-control';

const svelteHandle: Handle = async ({ event, resolve }) => {
  const response = await resolve(event);

  return response;
};

export const handle = sequence(
  cacheControlHandle(env.REDIS_URL, { etagCacheKey: 'some-etag' }),
  svelteHandle,
);
```
