// Service worker de avisos push. Muestra el aviso aunque la app esté cerrada.
self.addEventListener("push", (event) => {
  let datos = {};
  try { datos = event.data ? event.data.json() : {}; } catch { datos = { title: "Pedí por WhatsApp", body: event.data?.text() }; }
  event.waitUntil(self.registration.showNotification(datos.title || "Pedí por WhatsApp", {
    body: datos.body || "Tenés novedades en tu kiosco",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: "pedido-nuevo",
    renotify: true,
    data: { url: datos.url || "/panel" },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/panel";
  event.waitUntil((async () => {
    const ventanas = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const v of ventanas) { if ("focus" in v) { await v.focus(); return; } }
    await self.clients.openWindow(url);
  })());
});
