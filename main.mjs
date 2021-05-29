import turfDistance from "@turf/distance";

import { abortableFetch, FetchAbortController } from "./fetch.mjs";
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
  const q = new Query(req);

  let source = "";
  let contentType = "text/plain";
  let body = "";
  const abort = new FetchAbortController();
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
    const url = new URL(req.url);
    const ip = req.headers.get("CF-Connecting-IP") || "";
    this.k = Number.parseInt(url.searchParams.get("k"), 10);
    if (!Number.isFinite(this.k) || this.k < 1) {
      this.k = 1;
    }
    this.cap = url.searchParams.getAll("cap") || ["udp"];
    this.ipv4 = Query.parseBooleanParam(url, "ipv4", true);
    this.ipv6 = Query.parseBooleanParam(url, "ipv6", ip.includes(":"));
    this.lon = Query.parseFloatParam(url, "lon", -180, 180, req.cf.longitude);
    this.lat = Query.parseFloatParam(url, "lat", -90, 90, req.cf.latitude);
  }

  /**
   * @private
   * @param {URL} url
   * @param {string} key
   * @param {boolean} dflt
   * @returns {boolean}
   */
  static parseBooleanParam(url, key, dflt) {
    switch (url.searchParams.get(key)) {
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
   * @param {URL} url
   * @param {string} key
   * @param {number} min
   * @param {number} max
   * @param {number} dflt
   * @returns {number}
   */
  static parseFloatParam(url, key, min, max, dflt) {
    const v = Number.parseFloat(url.searchParams.get(key));
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
    s.set("k", `${this.k}`);
    for (const c of this.cap) {
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

  const res = await abortableFetch(req, signal);
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
  const avail = routers.filter((router) => q.cap.some((c) => !!router[c]));
  avail.sort((a, b) => {
    return distance(pos, a.position) - distance(pos, b.position);
  });
  return ["text/plain", avail.slice(0, q.k).map((router) => router.host).join(",")];
}
