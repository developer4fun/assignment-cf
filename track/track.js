const SESSION_STORAGE_KEY = "analytics_session_id";
const FLUSH_INTERVAL_MS = 1000;
const MAX_BATCH_SIZE = 25;
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_BASE_DELAY = 1000;

let sessionId = null;
let queue = [];

const generateUUID = () => {
  if (crypto?.randomUUID) {
    return crypto.randomUUID();
  }

  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const random = (Math.random() * 16) | 0;
    const value = char === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
};

const getOrCreateSessionId = () => {
  try {
    const existing = localStorage.getItem(SESSION_STORAGE_KEY);

    if (existing) {
      return existing;
    }

    const newSessionId = generateUUID();

    localStorage.setItem(SESSION_STORAGE_KEY, newSessionId);

    return newSessionId;
  } catch {
    return generateUUID();
  }
};

const getApiUrl = () => {
  if (window.ANALYTICS_API_URL) {
    return window.ANALYTICS_API_URL;
  }

  return window.location.hostname === "localhost"
    ? "http://localhost:5000/api/events"
    : "https://tracklens-es9f.onrender.com/api/events";
};

const buildEvent = (eventType, extra = {}) => ({
  session_id: sessionId,
  event_type: eventType,
  page_url: window.location.href,
  timestamp: new Date().toISOString(),
  ...extra,
});

const enqueue = (event) => {
  queue.push(event);

  if (queue.length >= MAX_BATCH_SIZE) {
    flush();
  }
};

const sendBatch = async (events, attempt = 1) => {
  try {
    const response = await fetch(getApiUrl(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ events }),
      keepalive: true,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
  } catch (error) {
    if (attempt < MAX_RETRY_ATTEMPTS) {
      const delay = RETRY_BASE_DELAY * 2 ** (attempt - 1);

      await new Promise((resolve) => setTimeout(resolve, delay));

      return sendBatch(events, attempt + 1);
    }
    console.warn("[tracker] Failed to send events:", error.message);
  }
};

const flush = () => {
  if (!queue.length) return;

  const batch = [...queue];
  queue = [];

  sendBatch(batch);
};

const flushOnUnload = () => {
  if (!queue.length) return;

  const payload = JSON.stringify({
    events: queue,
  });

  queue = [];

  if (navigator.sendBeacon) {
    const blob = new Blob([payload], {
      type: "application/json",
    });

    navigator.sendBeacon(getApiUrl(), blob);
  }
};

const trackPageView = () => {
  enqueue(buildEvent("page_view"));
};

const trackClick = (event) => {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  const clientX = event.clientX;
  const clientY = event.clientY;
  const normalizedX = clientX / viewportWidth;
  const normalizedY = clientY / viewportHeight;

  const docWidth = document.documentElement.scrollWidth;
  const docHeight = document.documentElement.scrollHeight;

  enqueue(
    buildEvent("click", {
      click: {
        x: event.pageX / docWidth,
        y: event.pageY / docHeight,
        viewport_width: window.innerWidth,
        viewport_height: window.innerHeight,
        doc_width: docWidth,
        doc_height: docHeight,
      },
    }),
  );
};

const initAnalytics = () => {
  sessionId = getOrCreateSessionId();

  if (!sessionId) {
    console.error("[tracker] Failed to initialize session ID");
    return;
  }

  trackPageView();

  document.addEventListener("click", trackClick, true);

  setInterval(flush, FLUSH_INTERVAL_MS);

  window.addEventListener("beforeunload", flushOnUnload);

  window.addEventListener("pagehide", flushOnUnload);
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initAnalytics);
} else {
  initAnalytics();
}
