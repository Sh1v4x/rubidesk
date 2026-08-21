import { invoke } from "@tauri-apps/api/core";

export interface HaConfig {
  url: string;
  token: string;
}

export interface HaEntity {
  entity_id: string;
  state: string;
  attributes: { friendly_name?: string; [key: string]: unknown };
}

const STORAGE_KEY = "rubilax.ha";

export function loadConfig(): HaConfig | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const cfg = JSON.parse(raw) as HaConfig;
    return cfg.url && cfg.token ? cfg : null;
  } catch {
    return null;
  }
}

export function saveConfig(cfg: HaConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
}

export async function check(cfg: HaConfig): Promise<{ message: string }> {
  return invoke("ha_check", { baseUrl: cfg.url, token: cfg.token });
}

export async function getStates(cfg: HaConfig): Promise<HaEntity[]> {
  return invoke("ha_states", { baseUrl: cfg.url, token: cfg.token });
}

export async function callService(
  cfg: HaConfig,
  domain: string,
  service: string,
  entityId: string,
): Promise<unknown> {
  return invoke("ha_call_service", {
    baseUrl: cfg.url,
    token: cfg.token,
    domain,
    service,
    entityId,
  });
}
