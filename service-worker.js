// Cambia este número en cada publicación para renovar los archivos guardados.
const APP_VERSION = "romantic-countdown-v7-install";
const SHELL_CACHE = `${APP_VERSION}-shell`;
const PHOTO_CACHE = `${APP_VERSION}-photos`;
// Cambia esta versión únicamente cuando cambien los archivos de música.
const MUSIC_CACHE = "romantic-music-v1";
const MUSIC_FILES = [
    new URL("./music/Coincidir.mp3", self.registration.scope).href,
    new URL("./music/Creo_en_ti.mp3", self.registration.scope).href
];
const APP_SHELL = [
    "./",
    "./index.html",
    "./manifest.webmanifest",
    "./assets/photo.jpg",
    "./icons/app-icon-192.png",
    "./icons/app-icon-512.png",
    "./icons/app-icon-maskable-512.png",
    "./icons/apple-touch-icon.png"
];

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(SHELL_CACHE)
            .then((cache) => cache.addAll(APP_SHELL))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(
                keys
                    .filter((key) => key !== SHELL_CACHE && key !== PHOTO_CACHE && key !== MUSIC_CACHE)
                    .map((key) => caches.delete(key))
            ))
            .then(() => self.clients.claim())
    );
});

let musicCachingPromise = null;

function cacheMusic() {
    if (musicCachingPromise) {
        return musicCachingPromise;
    }

    musicCachingPromise = (async () => {
        const cache = await caches.open(MUSIC_CACHE);

        for (const url of MUSIC_FILES) {
            const cached = await cache.match(url);

            if (cached) {
                continue;
            }

            const response = await fetch(url);
            if (response.ok) {
                await cache.put(url, response);
            }
        }

        return (await cache.keys()).length;
    })().finally(() => {
        musicCachingPromise = null;
    });

    return musicCachingPromise;
}

function parseRange(rangeHeader, totalBytes) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader || "");
    if (!match) {
        return null;
    }

    let start = match[1] ? Number(match[1]) : null;
    let end = match[2] ? Number(match[2]) : null;

    if (start === null && end !== null) {
        start = Math.max(totalBytes - end, 0);
        end = totalBytes - 1;
    } else {
        start = start ?? 0;
        end = end === null ? totalBytes - 1 : Math.min(end, totalBytes - 1);
    }

    if (start < 0 || end < start || start >= totalBytes) {
        return null;
    }

    return { start, end };
}

async function serveAudio(request) {
    const cache = await caches.open(MUSIC_CACHE);
    const cached = await cache.match(request.url);

    if (!cached) {
        return fetch(request);
    }

    const rangeHeader = request.headers.get("range");
    if (!rangeHeader) {
        return cached;
    }

    const audioData = await cached.arrayBuffer();
    const range = parseRange(rangeHeader, audioData.byteLength);

    if (!range) {
        return new Response(null, {
            status: 416,
            headers: { "Content-Range": `bytes */${audioData.byteLength}` }
        });
    }

    const chunk = audioData.slice(range.start, range.end + 1);
    return new Response(chunk, {
        status: 206,
        headers: {
            "Accept-Ranges": "bytes",
            "Content-Length": String(chunk.byteLength),
            "Content-Range": `bytes ${range.start}-${range.end}/${audioData.byteLength}`,
            "Content-Type": cached.headers.get("Content-Type") || "audio/mpeg"
        }
    });
}

self.addEventListener("message", (event) => {
    if (event.data?.type === "CACHE_MUSIC") {
        event.waitUntil(
            cacheMusic().then((count) => {
                event.ports[0]?.postMessage({ ready: count === MUSIC_FILES.length, count });
            })
        );
    }
});

self.addEventListener("fetch", (event) => {
    const request = event.request;

    if (request.method !== "GET") {
        return;
    }

    if (request.destination === "audio" || new URL(request.url).pathname.endsWith(".mp3")) {
        event.respondWith(serveAudio(request));
        return;
    }

    if (request.mode === "navigate") {
        event.respondWith(
            fetch(request)
                .then((response) => {
                    const copy = response.clone();
                    caches.open(SHELL_CACHE).then((cache) => cache.put("./index.html", copy));
                    return response;
                })
                .catch(() => caches.match("./index.html"))
        );
        return;
    }

    if (request.destination === "image") {
        event.respondWith(
            caches.match(request).then((cached) => {
                if (cached) {
                    return cached;
                }

                return fetch(request).then((response) => {
                    if (response.ok || response.type === "opaque") {
                        const copy = response.clone();
                        caches.open(PHOTO_CACHE).then((cache) => cache.put(request, copy));
                    }
                    return response;
                });
            })
        );
        return;
    }

    event.respondWith(
        caches.match(request).then((cached) => {
            const networkResponse = fetch(request)
                .then((response) => {
                    if (response.ok && new URL(request.url).origin === self.location.origin) {
                        const copy = response.clone();
                        caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
                    }
                    return response;
                })
                .catch(() => cached);

            return cached || networkResponse;
        })
    );
});
