self.addEventListener("push", (event) => {
  let payload = {
    title: "Companion",
    message: "You have a new update.",
    url: "/companion/"
  };

  if (event.data) {
    try {
      const parsed = event.data.json();
      payload = {
        title: typeof parsed.title === "string" ? parsed.title : payload.title,
        message: typeof parsed.message === "string" ? parsed.message : payload.message,
        url: typeof parsed.url === "string" ? parsed.url : payload.url
      };
    } catch {
      const text = event.data.text();
      payload.message = text || payload.message;
    }
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.message,
      icon: "/companion/icon.svg",
      badge: "/companion/icon.svg",
      data: {
        url: payload.url
      }
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl =
    event.notification.data && typeof event.notification.data.url === "string"
      ? event.notification.data.url
      : "/companion/";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if ("focus" in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
      return undefined;
    })
  );
});
