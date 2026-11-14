"use client";
import { useEffect, useState } from "react";

type BIPEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };
const KEY_BASE = "padaya-install-dismissed";
const isStandalone = () =>
  typeof window !== "undefined" && (window.matchMedia?.("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true);
const isIOS = () => typeof navigator !== "undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent) && !/crios|fxios|edgios/i.test(navigator.userAgent);

/** Registers the service worker once (production only). */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator) || process.env.NODE_ENV !== "production") return;
    if ((window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.()) return;
    navigator.serviceWorker.register("/sw.js").catch(() => null);
  }, []);
  return null;
}

/**
 * "Add Padaya to your home screen": an Install button where the browser supports it (Android Chrome, desktop),
 * and short Share → Add to Home Screen steps on iPhone Safari. Hidden once installed or dismissed.
 */
export function InstallPrompt({ appName = "Padaya", pitch = "Open it like an app — order coffee or book a scooter in one tap." }: { appName?: string; pitch?: string } = {}) {
  const key = appName === "Padaya" ? KEY_BASE : `${KEY_BASE}:${appName}`;
  const [evt, setEvt] = useState<BIPEvent | null>(null);
  const [mode, setMode] = useState<"none" | "button" | "ios">("none");
  const [done, setDone] = useState(false);

  useEffect(() => {
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(key) === "1";
    } catch {}
    if (dismissed || isStandalone()) return;
    if (isIOS()) setMode("ios");
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setEvt(e as BIPEvent);
      setMode("button");
    };
    const onInstalled = () => setDone(true);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, [key]);

  const dismiss = () => {
    try {
      localStorage.setItem(key, "1");
    } catch {}
    setMode("none");
  };
  const install = async () => {
    if (!evt) return;
    await evt.prompt();
    const { outcome } = await evt.userChoice;
    setEvt(null);
    if (outcome === "accepted") setDone(true);
    else setMode("none");
  };

  if (done) return <p className="rounded-2xl bg-orange-50 px-4 py-3 text-center text-sm font-semibold text-orange-800">{appName} is on your home screen ✓</p>;
  if (mode === "none") return null;
  return (
    <section className="card flex items-start gap-3 p-4" data-testid="install-prompt" aria-label={`Add ${appName} to your home screen`}>
      <span aria-hidden className="text-2xl">
        📲
      </span>
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-bold">Add {appName} to your home screen</p>
        {mode === "button" ? (
          <>
            <p className="text-coffee-700">{pitch}</p>
            <button type="button" className="btn-primary btn-sm mt-2" onClick={install}>
              Install
            </button>
          </>
        ) : (
          <p className="text-coffee-700" data-testid="ios-steps">
            Tap the <strong>Share</strong> button{" "}
            <span aria-hidden className="inline-block rounded border border-coffee-300 px-1">
              ⬆
            </span>{" "}
            at the bottom of Safari, then <strong>Add to Home Screen</strong>.
          </p>
        )}
      </div>
      <button type="button" className="text-xl leading-none text-coffee-500" onClick={dismiss} aria-label="Not now">
        ×
      </button>
    </section>
  );
}
