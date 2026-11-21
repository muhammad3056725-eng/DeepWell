// Optional crowd-rarity client. With CONFIG.CROWD_ENDPOINT empty this is a no-op and
// every score comes from Wikidata alone. See docs/crowd-backend.md for the backend.
import { CONFIG } from './config.js';

export const crowdEnabled = () => Boolean(CONFIG.CROWD_ENDPOINT);

/** -> {count, total} for this answer on this prompt, or null (disabled, offline, slow). */
export async function crowdStats(promptKey, answerKey) {
  if (!crowdEnabled()) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CONFIG.CROWD_TIMEOUT_MS);
  try {
    const url = `${CONFIG.CROWD_ENDPOINT}/stats?p=${encodeURIComponent(promptKey)}&k=${encodeURIComponent(answerKey)}`;
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return null;
    const data = await res.json();
    return { count: Number(data.count) || 0, total: Number(data.total) || 0 };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Fire-and-forget: record that this answer was given (only valid answers are sent). */
export function crowdSubmit(promptKey, answerKey) {
  if (!crowdEnabled()) return;
  try {
    fetch(`${CONFIG.CROWD_ENDPOINT}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ p: promptKey, k: answerKey }),
      keepalive: true,
    }).catch(() => {});
  } catch { /* ignore */ }
}
