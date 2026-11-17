const APP_CACHE = 'ppl-app-v3';
const MEDIA_CACHE = 'ppl-media-v1';

const APP_ASSETS = [
  './',
  './index.html',
  './exercises.js',
  './ico/app.png'
];

// Установка Service Worker и кэширование файлов приложения и базы упражнений
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(APP_CACHE).then((cache) => cache.addAll(APP_ASSETS))
  );
});

// Активация: удаляем устаревшие кэши приложения, но сохраняем кэш видео и фото (ppl-media-v1)
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== APP_CACHE && key !== MEDIA_CACHE)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// Корректная отдача закэшированных видео по Range-запросам (критично для iOS Safari офлайн)
async function handleRangeRequest(request) {
  const cachedResponse = await caches.match(request.url);
  if (!cachedResponse) {
    return fetch(request);
  }

  const arrayBuffer = await cachedResponse.arrayBuffer();
  const totalBytes = arrayBuffer.byteLength;
  const rangeHeader = request.headers.get('range') || '';
  const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);

  if (!match) {
    return new Response(arrayBuffer, {
      status: 200,
      headers: {
        'Content-Type': cachedResponse.headers.get('Content-Type') || 'video/mp4',
        'Content-Length': String(totalBytes),
        'Accept-Ranges': 'bytes'
      }
    });
  }

  const start = Number(match[1]);
  const end = match[2] ? Math.min(Number(match[2]), totalBytes - 1) : totalBytes - 1;

  if (start >= totalBytes || start > end) {
    return new Response(null, {
      status: 416,
      headers: {
        'Content-Range': `bytes */${totalBytes}`
      }
    });
  }

  const sliced = arrayBuffer.slice(start, end + 1);
  return new Response(sliced, {
    status: 206,
    statusText: 'Partial Content',
    headers: {
      'Content-Type': cachedResponse.headers.get('Content-Type') || 'video/mp4',
      'Content-Range': `bytes ${start}-${end}/${totalBytes}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': String(sliced.byteLength)
    }
  });
}

// Перехват сетевых запросов (Cache-First с фоновым сохранением)
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  if (event.request.headers.has('range')) {
    event.respondWith(handleRangeRequest(event.request));
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;

      return fetch(event.request).then((response) => {
        if (!response || response.status !== 200) {
          return response;
        }
        const reqUrl = new URL(event.request.url);
        const isSameOrigin = reqUrl.origin === self.location.origin;
        const isFontOrTailwind =
          reqUrl.hostname.includes('tailwindcss.com') ||
          reqUrl.hostname.includes('googleapis.com') ||
          reqUrl.hostname.includes('gstatic.com');

        if (isSameOrigin || isFontOrTailwind) {
          const clone = response.clone();
          caches.open(APP_CACHE).then((cache) => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});
