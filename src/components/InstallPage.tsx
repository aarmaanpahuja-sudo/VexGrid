import { useEffect, useState } from "react";
import { Download, Share, Smartphone, CheckCircle2 } from "lucide-react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as any).standalone === true
  );
}

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
}

export default function InstallPage() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);

  useEffect(() => {
    // Already running as installed app?
    if (isStandalone()) {
      setIsInstalled(true);
      return;
    }

    // Listen for Android install prompt
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") {
      setDeferredPrompt(null);
      setIsInstalled(true);
    }
  };

  // Already installed
  if (isInstalled) {
    return (
      <div className="mx-auto max-w-lg px-4 py-10 text-center">
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-400">
          <CheckCircle2 size={32} />
        </div>
        <h2 className="text-xl font-semibold text-white">You’re all set!</h2>
        <p className="mt-2 text-sm text-slate-400">
          VexGrid is already installed on this device and running in full-screen mode.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg space-y-8 px-4 py-8">
      <div className="text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-slate-900">
          <Smartphone size={28} />
        </div>
        <h2 className="text-xl font-semibold text-white">Install VexGrid</h2>
        <p className="mt-2 text-sm text-slate-400">
          Add VexGrid to your home screen for the best experience — full screen, faster, and always one tap away.
        </p>
      </div>

      {/* Android / Chrome */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
          <Download size={16} />
          Android / Chrome
        </h3>

        {deferredPrompt ? (
          <button
            onClick={handleInstallClick}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-semibold text-slate-900 transition hover:bg-slate-200"
          >
            <Download size={18} />
            Install VexGrid
          </button>
        ) : (
          <p className="text-sm text-slate-400">
            Open this page in Chrome on your Android phone. An install button will appear here when available.
          </p>
        )}
      </div>

      {/* iPhone */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
          <Share size={16} />
          iPhone / iPad
        </h3>
        <ol className="space-y-3 text-sm text-slate-300">
          <li className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-800 text-xs font-medium text-slate-300">1</span>
            <span>Tap the <strong className="text-white">Share</strong> button at the bottom of Safari</span>
          </li>
          <li className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-800 text-xs font-medium text-slate-300">2</span>
            <span>Scroll down and tap <strong className="text-white">Add to Home Screen</strong></span>
          </li>
          <li className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-800 text-xs font-medium text-slate-300">3</span>
            <span>Tap <strong className="text-white">Add</strong> in the top right corner</span>
          </li>
        </ol>
      </div>
    </div>
  );
}
