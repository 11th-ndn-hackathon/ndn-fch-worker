import turfDistance from "@turf/distance";

import { listRouters } from "./testbed.mjs";

/**
 * @type {(a: [number,number], b: [number,number]) => number}
 */
const distance = typeof turfDistance === "function" ? turfDistance : turfDistance.default;

addEventListener("fetch", (event) => {
  event.respondWith(handleRequest(event.request));
});

const API = "https://fch-dal.ndn.today/api/";

/**
 * @param {Request} req
 */
async function handleRequest(req) {
  const uri = new URL(req.url);
  switch (uri.pathname) {
    case "/robots.txt":
      return new Response("User-Agent: *\nDisallow: /\n");
    case "/":
      return handleQuery(req);
    default:
      return new Response("", { status: 404 });
  }
}

/**
 * @param {Request} req
 */
async function handleQuery(req) {
  const q = new Query(req);

  let source = "";
  let contentType = "text/plain";
  let body = "";
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(new Error("timeout")), 1000);
  try {
    [contentType, body] = await apiRequest(q, req.headers.get("accept"), abort.signal);
    clearTimeout(timer);
    source = "api";
  } catch (err) {
    console.error(`apiRequest error ${err}`);
  }

  if (!body) {
    [contentType, body] = await fallbackLogic(q);
    source = "fallback";
  }

  const res = new Response(body);
  res.headers.set("Access-Control-Allow-Origin", "*");
  res.headers.set("Content-Type", contentType);
  res.headers.set("X-FCH-source", source);
  res.headers.set("X-FCH-query", `${q.toSearchParams()}`);
  return res;
}

class Query {
  /**
   * @param {Request} req
   */
  constructor(req) {
    const { searchParams: s } = new URL(req.url);
    const ip = req.headers.get("CF-Connecting-IP") || "";
    this.count = (s.has("k") ? s.getAll("k") : ["1"]).map((k) => {
      const n = Number.parseInt(k, 10);
      return Number.isFinite(n) ? Math.max(1, n) : 1;
    });
    this.transport = s.has("cap") ? s.getAll("cap") : ["udp"];
    this.ipv4 = Query.parseBooleanParam(s, "ipv4", true);
    this.ipv6 = Query.parseBooleanParam(s, "ipv6", ip.includes(":"));
    this.lon = Query.parseFloatParam(s, "lon", -180, 180, req.cf.longitude);
    this.lat = Query.parseFloatParam(s, "lat", -90, 90, req.cf.latitude);
  }

  /**
   * @private
   * @param {URLSearchParams} search
   * @param {string} key
   * @param {boolean} dflt
   * @returns {boolean}
   */
  static parseBooleanParam(search, key, dflt) {
    switch (search.get(key)) {
      case "1":
        return true;
      case "0":
        return false;
      default:
        return dflt;
    }
  }

  /**
   * @private
   * @param {URLSearchParams} search
   * @param {string} key
   * @param {number} min
   * @param {number} max
   * @param {number} dflt
   * @returns {number}
   */
  static parseFloatParam(search, key, min, max, dflt) {
    const v = Number.parseFloat(search.get(key));
    if (v >= min && v <= max) {
      return v;
    }
    return dflt;
  }

  /**
   * @returns {URLSearchParams}
   */
  toSearchParams() {
    const s = new URLSearchParams();
    for (const k of this.count) {
      s.append("k", `${k}`);
    }
    for (const c of this.transport) {
      s.append("cap", c);
    }
    s.set("ipv4", this.ipv4 ? "1" : "0");
    s.set("ipv6", this.ipv6 ? "1" : "0");
    s.set("lon", `${this.lon}`);
    s.set("lat", `${this.lat}`);
    return s;
  }
}

/**
 * @param {Query} q
 * @param {string} accept
 * @param {AbortSignal} signal
 * @returns {Promise<[string, string]>}
 */
async function apiRequest(q, accept, signal) {
  const uri = new URL(API);
  for (const [k, v] of q.toSearchParams()) {
    uri.searchParams.append(k, v);
  }

  const req = new Request(uri, {
    headers: {
      Accept: accept,
    },
  });

  const res = await fetch(req, { signal });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return [res.headers.get("Content-Type"), await res.text()];
}

/**
 * @param {Query} q
 * @returns {Promise<[string, string]>}
 */
async function fallbackLogic(q) {
  const pos = [q.lon, q.lat];
  const routers = await listRouters();
  const avail = routers.filter((router) => q.transport.some((c) => !!router[c]));
  avail.sort((a, b) => distance(pos, a.position) - distance(pos, b.position));
  return ["text/plain", avail.slice(0, q.count[0]).map((router) => router.host).join(",")];
}
