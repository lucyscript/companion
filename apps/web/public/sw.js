self.addEventListener("push", (event) => {
  let payload = {
    title: "Companion",
    message: "You have a new update.",
    url: "/companion/",
    deadlineId: null,
    source: null,
    priority: "medium",
    notificationId: null,
    actions: null
  };

  if (event.data) {
    try {
      const parsed = event.data.json();
      payload = {
        title: typeof parsed.title === "string" ? parsed.title : payload.title,
        message: typeof parsed.message === "string" ? parsed.message : payload.message,
        url: typeof parsed.url === "string" ? parsed.url : payload.url,
        deadlineId: typeof parsed.deadlineId === "string" ? parsed.deadlineId : payload.deadlineId,
        source: typeof parsed.source === "string" ? parsed.source : payload.source,
        priority: typeof parsed.priority === "string" ? parsed.priority : payload.priority,
        notificationId: typeof parsed.notificationId === "string" ? parsed.notificationId : payload.notificationId,
        actions: Array.isArray(parsed.actions) ? parsed.actions : payload.actions
      };
    } catch {
      const text = event.data.text();
      payload.message = text || payload.message;
    }
  }

  const notificationOptions = {
    body: payload.message,
    icon: "/companion/icon.svg",
    badge: "/companion/icon.svg",
    data: {
      url: payload.url,
      deadlineId: payload.deadlineId,
      source: payload.source,
      priority: payload.priority,
      notificationId: payload.notificationId,
      notificationTitle: payload.title,
      timestamp: Date.now()
    }
  };

  // Add action buttons based on notification source and actions array
  const actionButtons = [];

  // Use explicit actions array if provided, otherwise infer from source
  const requestedActions = payload.actions || [];

  if (requestedActions.length === 0) {
    // Fallback: legacy behavior for assignment-tracker with deadlineId
    if (payload.deadlineId && payload.source === "assignment-tracker") {
      actionButtons.push({ action: "complete", title: "Mark complete" });
      actionButtons.push({ action: "working", title: "Still working" });
    }
  } else {
    // Use requested actions
    for (const action of requestedActions) {
      if (action === "complete") {
        actionButtons.push({ action: "complete", title: "Complete" });
      } else if (action === "snooze") {
        actionButtons.push({ action: "snooze", title: "Snooze 30m" });
      } else if (action === "view") {
        actionButtons.push({ action: "view", title: "View" });
      }
    }
  }

  if (actionButtons.length > 0) {
    notificationOptions.actions = actionButtons;
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, notificationOptions)
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  // Track tap interaction
  const data = event.notification.data || {};
  if (data.notificationId && data.source && data.priority && data.notificationTitle) {
    const timeToInteractionMs = data.timestamp ? Date.now() - data.timestamp : undefined;

    event.waitUntil(
      fetch("/companion/api/notification-interactions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          notificationId: data.notificationId,
          notificationTitle: data.notificationTitle,
          notificationSource: data.source,
          notificationPriority: data.priority,
          interactionType: "tap",
          timeToInteractionMs
        })
      }).catch(() => {
        // Silently fail if tracking fails
      })
    );
  }

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

self.addEventListener("notificationclose", (event) => {
  // Track dismiss interaction
  const data = event.notification.data || {};
  if (data.notificationId && data.source && data.priority && data.notificationTitle) {
    const timeToInteractionMs = data.timestamp ? Date.now() - data.timestamp : undefined;

    event.waitUntil(
      fetch("/companion/api/notification-interactions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          notificationId: data.notificationId,
          notificationTitle: data.notificationTitle,
          notificationSource: data.source,
          notificationPriority: data.priority,
          interactionType: "dismiss",
          timeToInteractionMs
        })
      }).catch(() => {
        // Silently fail if tracking fails
      })
    );
  }
});

self.addEventListener("notificationactionclick", (event) => {
  event.notification.close();

  // Track action button interaction
  const data = event.notification.data || {};
  if (data.notificationId && data.source && data.priority && data.notificationTitle) {
    const timeToInteractionMs = data.timestamp ? Date.now() - data.timestamp : undefined;

    event.waitUntil(
      fetch("/companion/api/notification-interactions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          notificationId: data.notificationId,
          notificationTitle: data.notificationTitle,
          notificationSource: data.source,
          notificationPriority: data.priority,
          interactionType: "action",
          actionType: event.action,
          timeToInteractionMs
        })
      }).catch(() => {
        // Silently fail if tracking fails
      })
    );
  }

  // Handle different action types
  if (event.action === "snooze") {
    // Snooze the notification
    const notificationId = data.notificationId;
    if (notificationId) {
      event.waitUntil(
        fetch("/companion/api/notifications/snooze", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            notificationId,
            snoozeMinutes: 30
          })
        })
          .then((response) => {
            if (response.ok) {
              return self.registration.showNotification("Snoozed", {
                body: "Notification snoozed for 30 minutes",
                icon: "/companion/icon.svg",
                badge: "/companion/icon.svg"
              });
            } else {
              return self.registration.showNotification("Snooze failed", {
                body: "Could not snooze notification. Please try again.",
                icon: "/companion/icon.svg",
                badge: "/companion/icon.svg"
              });
            }
          })
          .catch(() => {
            return self.registration.showNotification("Snooze failed", {
              body: "Could not snooze notification. Please try again.",
              icon: "/companion/icon.svg",
              badge: "/companion/icon.svg"
            });
          })
      );
    }
    return;
  }

  if (event.action === "view") {
    // Navigate to the specified URL or default page
    const targetUrl = data.url || "/companion/";
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
    return;
  }

  // Handle complete/working actions for deadlines
  const deadlineId = event.notification.data?.deadlineId;

  if (!deadlineId) {
    return;
  }

  const completed = event.action === "complete";
  const actionText = completed ? "completed" : "in progress";

  event.waitUntil(
    fetch(`/companion/api/deadlines/${deadlineId}/confirm-status`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ completed })
    })
      .then((response) => {
        if (response.ok) {
          return self.registration.showNotification("Status updated", {
            body: `Deadline marked as ${actionText}`,
            icon: "/companion/icon.svg",
            badge: "/companion/icon.svg"
          });
        } else {
          return self.registration.showNotification("Update failed", {
            body: "Could not update deadline status. Please try again.",
            icon: "/companion/icon.svg",
            badge: "/companion/icon.svg"
          });
        }
      })
      .catch(() => {
        return self.registration.showNotification("Update failed", {
          body: "Could not update deadline status. Please try again.",
          icon: "/companion/icon.svg",
          badge: "/companion/icon.svg"
        });
      })
  );
});
