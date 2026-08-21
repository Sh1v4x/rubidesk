/** Mise à jour automatique depuis les releases GitHub (artefacts signés). */

import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export async function checkForUpdates(
  onFound: (version: string) => void,
  onInstalled: () => void,
): Promise<void> {
  try {
    const update = await check();
    if (!update) return;
    onFound(update.version);
    await update.downloadAndInstall();
    onInstalled();
    window.setTimeout(() => void relaunch(), 3000);
  } catch (e) {
    // en dev (non signé) ou hors ligne : silencieux
    console.warn("[updater]", e);
  }
}
