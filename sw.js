// Minimal service worker — just enough to make GiftGenie installable as a PWA /
// packageable as the GiftGenie Lite Android app (TWA requires an active SW).
// Network-first: every request goes to the network, falling back to cache only
// if the network fails, so the Groq-backed /api/suggest calls are never served
// stale, while the shell still loads offline after the first visit.
var CACHE = "giftgenie-v1";
var SHELL = ["./", "./index.html", "./manifest.json"];

self.addEventListener("install", function(event){
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then(function(cache){ return cache.addAll(SHELL); }).catch(function(){})
  );
});

self.addEventListener("activate", function(event){
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", function(event){
  if(event.request.method !== "GET") return;
  var url = new URL(event.request.url);
  if(url.pathname.indexOf("/api/") === 0) return; // never cache AI calls

  event.respondWith(
    fetch(event.request)
      .then(function(res){
        var copy = res.clone();
        caches.open(CACHE).then(function(cache){ cache.put(event.request, copy); }).catch(function(){});
        return res;
      })
      .catch(function(){ return caches.match(event.request); })
  );
});
