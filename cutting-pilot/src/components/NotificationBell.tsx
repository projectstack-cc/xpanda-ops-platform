"use client";
// src/components/NotificationBell.tsx (notif-bell-01)
// The v2 header's notification bell IS the legacy one: this renders an empty slot and loads the
// shared vanilla /shared/notif-bell.js (served by the legacy app on the same host, like
// /logo/xpanda.png), which mounts the home page's bell into it — same look, dropdown, mark-all-read,
// deep links, and push enable/self-heal on every legacy and /v2 page, one implementation.
// React never renders children into the slot, so the script owns that DOM; an unmounted slot is
// dropped by the script on its next poll (isConnected check).
import { useEffect, useRef } from "react";

const SCRIPT_SRC = "/shared/notif-bell.js";

declare global {
  interface Window {
    XpNotifBell?: { mount: (el: Element) => void; mountAll: () => void };
  }
}

export default function NotificationBell({ className = "" }: { className?: string }) {
  const slotRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const mount = () => {
      if (slotRef.current) window.XpNotifBell?.mount(slotRef.current);
    };
    if (window.XpNotifBell) {
      mount();
      return;
    }
    let script = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`);
    if (!script) {
      script = document.createElement("script");
      script.src = SCRIPT_SRC;
      script.async = true;
      document.head.appendChild(script);
    }
    script.addEventListener("load", mount);
    return () => script?.removeEventListener("load", mount);
  }, []);

  return <span ref={slotRef} className={className} />;
}
