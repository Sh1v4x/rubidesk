/** Mise à jour automatique depuis les releases GitHub (artefacts signés). */

import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export type UpdateOutcome = "installing" | "none" | "error";

export async function checkForUpdates(
  onFound: (version: string) => void,
  onInstalled: () => void,
): Promise<UpdateOutcome> {
  try {
    const update = await check();
    if (!update) return "none";
    onFound(update.version);
    await update.downloadAndInstall();
    onInstalled();
    window.setTimeout(() => void relaunch(), 3000);
    return "installing";
  } catch (e) {
    // en dev (non signé) ou hors ligne : silencieux
    console.warn("[updater]", e);
    return "error";
  }
}
