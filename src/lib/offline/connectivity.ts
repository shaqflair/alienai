import { useEffect, useState } from "react";

export function useOffline() {
  const [offline, setOffline] = useState(typeof navigator !== "undefined" ? !navigator.onLine : false);

  useEffect(() => {
    const on = () => setOffline(false);
    const off = () => setOffline(true);

    window.addEventListener("online", on);
    window.addEventListener("offline", off);

    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  return offline;
}

export function isOnline() {
  if (typeof navigator === "undefined") return true;
  return navigator.onLine;
}