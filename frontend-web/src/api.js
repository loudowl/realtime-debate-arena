const BASE = '/api/streams';

async function asJson(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export async function fetchModels() {
  return asJson(await fetch(`${BASE}/models`)).then((d) => d.models);
}

export async function createSession({ url, models, declareWinner }) {
  return asJson(
    await fetch(BASE, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url, models, declareWinner }),
    })
  ).then((d) => d.session);
}

export async function stopSession(id) {
  return asJson(await fetch(`${BASE}/${id}/stop`, { method: 'POST' })).then((d) => d.session);
}

export async function fetchReports(id) {
  return asJson(await fetch(`${BASE}/${id}/report`)).then((d) => d.reports);
}

/** Build the live WebSocket URL from the current page origin (proxied by Vite). */
export function liveSocketUrl(id) {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${window.location.host}/api/streams/${id}/live`;
}
