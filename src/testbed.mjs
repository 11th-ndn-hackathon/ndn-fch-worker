/**
 * @typedef {{
 *   id: string;
 *   position: [lon: number, lat: number];
 *   host: string;
 *   udp: boolean;
 *   wss: boolean;
 * }} Router
 */

/**
 * Router list.
 * @type {Router[]}
 */
let routers = [];

/**
 * Last successful fetch timestamp.
 */
let lastFetch = 0;

/**
 * Retrieve global NDN testbed router list.
 * @param {AbortSignal} signal
 * @returns {Promise<Router[]>}
 */
async function fetchTestbedNodes(signal) {
  const res = await fetch("https://testbed-status.named-data.net/testbed-nodes.json", { signal });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const j = await res.json();

  /** @type {Router[]} */
  const routers = [];
  for (const o of Object.values(j)) {
    const pos = o._real_position || o.position;
    if (!Array.isArray(pos) || pos.length !== 2) {
      continue;
    }

    let host = "";
    try {
      const u = new URL(o.site);
      host = u.host;
    } catch {
      continue;
    }
    if (host === "" || host === "0.0.0.0") {
      continue;
    }

    routers.push({
      id: o.shortname,
      position: [pos[1], pos[0]],
      host,
      udp: o["fch-enabled"],
      wss: o["fch-enabled"] && o["ws-tls"],
    });
  }
  return routers;
}

/**
 * Obtain global NDN testbed router list.
 * @returns {Promise<Router[]>}
 */
export async function listRouters() {
  if (lastFetch + 3600000 < Date.now()) {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(new Error("timeout")), 2000);
    try {
      routers = await fetchTestbedNodes(abort.signal);
      clearTimeout(timer);
      lastFetch = Date.now();
    } catch (err) {
      console.error(`fetchTestbedNodes error ${err}`);
    }
  }
  return routers;
}
