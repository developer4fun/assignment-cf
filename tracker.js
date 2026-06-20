const SESSION_STORAGE_KEY = "analytics_session_id";
const FLUSH_INTERVAL_MS = 1000;
const MAX_BATCH_SIZE = 25;
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_BASE_DELAY = 1000;
const MOBILE_BREAKPOINT = 768;

let sessionId = null;
let queue = [];

export const generateUUID = () => {
  if (crypto?.randomUUID) {
    return crypto.randomUUID();
  }

  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const random = (Math.random() * 16) | 0;
    const value = char === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
};

export const getOrCreateSessionId = () => {
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

const getSessionKey = () => `${SESSION_STORAGE_KEY}_${currentDeviceType}`;

const getOrCreateDeviceSessionId = () => {
  try {
    const existing = localStorage.getItem(getSessionKey());
    if (existing) return existing;
    const newId = generateUUID();
    localStorage.setItem(getSessionKey(), newId);
    return newId;
  } catch {
    return generateUUID();
  }
};

const getApiUrl = () => {
  return window.ANALYTICS_API_URL || "http://localhost:5000/api/events";
};

const getDeviceType = () => {
  // Use document scroll width to match actual page width, not just viewport
  return window.innerWidth <= MOBILE_BREAKPOINT ? "mobile" : "desktop";
};

const mobileQuery = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`);

let currentDeviceType = getDeviceType();

window.addEventListener("resize", () => {
  const newDeviceType = getDeviceType();
  if (newDeviceType !== currentDeviceType) {
    currentDeviceType = newDeviceType;
    trackPageView(); // re-registers this "session" under the new device type
  }
});

const buildEvent = (eventType, extra = {}) => ({
  session_id: sessionId,
  event_type: eventType,
  page_url: window.location.href,
  timestamp: new Date().toISOString(),
  device_type: currentDeviceType,
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

export const flush = () => {
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

export const trackPageView = () => {
  enqueue(buildEvent("page_view"));
};

export const trackClick = (event) => {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  // Get the click position relative to viewport (what the user sees)
  // clientX/Y is relative to the visible viewport, not affected by scrolling
  const clientX = event.clientX;
  const clientY = event.clientY;

  // Normalize to [0, 1] relative to current viewport
  // This ensures coordinates are consistent regardless of scroll position
  const normalizedX = clientX / viewportWidth;
  const normalizedY = clientY / viewportHeight;

  enqueue(
    buildEvent("click", {
      click: {
        // Normalized position within viewport (0-1 range)
        x: normalizedX,
        y: normalizedY,
        // Viewport dimensions at time of click
        viewport_width: viewportWidth,
        viewport_height: viewportHeight,
      },
    }),
  );
};

export const initAnalytics = () => {
  currentDeviceType = getDeviceType();
  sessionId = getOrCreateDeviceSessionId();
  
  if (!sessionId) {
    console.error("[tracker] Failed to initialize session ID");
    return;
  }

  trackPageView();

  document.addEventListener("click", trackClick, true);

  setInterval(flush, FLUSH_INTERVAL_MS);

  window.addEventListener("beforeunload", flushOnUnload);

  window.addEventListener("pagehide", flushOnUnload);

  const handleBreakpointChange = (e) => {
    const newDeviceType = e.matches ? "mobile" : "desktop";
    if (newDeviceType !== currentDeviceType) {
      flush(); // send pending events under old device type first
      currentDeviceType = newDeviceType;
      sessionId = getOrCreateDeviceSessionId();
      trackPageView(); // register page view under new device type
    }
  };

  // addListener is used for broader browser support; addEventListener works in modern browsers
  if (mobileQuery.addEventListener) {
    mobileQuery.addEventListener("change", handleBreakpointChange);
  } else {
    mobileQuery.addListener(handleBreakpointChange); // Safari fallback
  }
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initAnalytics);
} else {
  initAnalytics();
}
