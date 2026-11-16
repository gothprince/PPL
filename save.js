const SHELL_CACHE = 'ppl-shell-v1';
const MEDIA_CACHE = 'ppl-media-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== SHELL_CACHE && key !== MEDIA_CACHE)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

function isMediaAsset(url) {
  return (
    /\/(video|photo|ico)\//i.test(url.pathname) ||
    /\.(mp4|webm|mov|ogg|gif|webp|jpg|jpeg|png)$/i.test(url.pathname)
  );
}

async function buildRangeResponse(request, fullResponse) {
  const rangeHeader = request.headers.get('range');
  if (!rangeHeader) return fullResponse;

  const buf = await fullResponse.arrayBuffer();
  const total = buf.byteLength;
  const match = /bytes=(\d+)-(\d*)/i.exec(rangeHeader);

  if (!match) {
    return new Response(buf, {
      status: 200,
      headers: fullResponse.headers
    });
  }

  const start = Number(match[1]);
  const end = match[2] ? Math.min(Number(match[2]), total - 1) : total - 1;

  if (start >= total || start > end) {
    return new Response(null, {
      status: 416,
      statusText: 'Range Not Satisfiable',
      headers: {
        'Content-Range': `bytes */${total}`
      }
    });
  }

  const sliced = buf.slice(start, end + 1);
  const headers = new Headers(fullResponse.headers);
  headers.set('Content-Range', `bytes ${start}-${end}/${total}`);
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Content-Length', String(sliced.byteLength));

  return new Response(sliced, {
    status: 206,
    statusText: 'Partial Content',
    headers
  });
}

async function handleMediaRequest(request) {
  const cache = await caches.open(MEDIA_CACHE);
  const cleanUrl = request.url.split('#')[0];
  let cached = await cache.match(cleanUrl);

  if (!cached) {
    try {
      const fresh = await fetch(cleanUrl, { cache: 'no-cache' });
      if (fresh && fresh.status === 200) {
        await cache.put(cleanUrl, fresh.clone());
        cached = fresh;
      } else if (fresh) {
        return fresh;
      }
    } catch (_) {
      return Response.error();
    }
  }

  if (!cached) return Response.error();
  return buildRangeResponse(request, cached);
}

async function handleNavigationRequest(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const fresh = await fetch(request);
    if (fresh && fresh.status === 200) {
      await cache.put(request, fresh.clone());
    }
    return fresh;
  } catch (_) {
    const cached = await cache.match(request);
    return cached || Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (isMediaAsset(url)) {
    event.respondWith(handleMediaRequest(event.request));
    return;
  }

  if (event.request.mode === 'navigate' || url.pathname.endsWith('.html')) {
    event.respondWith(handleNavigationRequest(event.request));
  }
});