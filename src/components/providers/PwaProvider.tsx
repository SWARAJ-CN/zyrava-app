import { createContext, useContext, useEffect, type ReactNode } from "react";
import { setItem } from "@/lib/store";

interface PwaApi {
  /** Ready to install: the browser's own prompt, or the iOS walk-through. */
  canInstall: boolean;
  /** iPhone/iPad Safari, where the only way in is Add to Home Screen. */
  manualInstall: boolean;
  /** True when `install()` walks the reader to the sheet instead of prompting. */
  installViaSheet: boolean;
  /** Running as its own app on the device rather than as a tab in a browser. */
  installed: boolean;
  /** Install touched, waiting on the device to confirm it. */
  installing: boolean;
  install: () => Promise<void>;
  /** The step-by-step sheet Safari's menu leads to. */
  sheetOpen: boolean;
  closeSheet: () => void;
}

/*
 * A native build is always installed: there is no beforeinstallprompt, no
 * manifest and no Add-to-Home-Screen walk-through to offer. The context keeps
 * the web's exact shape so every consumer compiles unchanged — install() is a
 * no-op, the sheet never opens, and `installed` is simply true.
 */
const CONTEXT_VALUE: PwaApi = {
  canInstall: false,
  manualInstall: false,
  installViaSheet: false,
  installed: true,
  installing: false,
  install: async () => {},
  sheetOpen: false,
  closeSheet: () => {},
};

const PwaContext = createContext<PwaApi>(CONTEXT_VALUE);

export function usePwa(): PwaApi {
  return useContext(PwaContext);
}

/**
 * The web provider remembered the two moments it could prove an install. Here
 * the proof is immediate — the app package on the home screen — so the mark is
 * written once at first launch and every reminder that reads it stays quiet.
 */
const INSTALLED_MARK = "zyrava:installed";

export function PwaProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    try {
      setItem(INSTALLED_MARK, "1");
    } catch {
      /* Storage turned off costs the reminder its memory, nothing more. */
    }
  }, []);

  return <PwaContext.Provider value={CONTEXT_VALUE}>{children}</PwaContext.Provider>;
}

/* Ported name: this is the install story on native, kept under the web's file
   and export so consumers import from "@/components/providers/PwaProvider". */
export { PwaProvider as InstallProvider };
