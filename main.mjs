import distance from "@turf/distance";

import { abortableFetch, FetchAbortController } from "./fetch.mjs";
import { listRouters } from "./testbed.mjs";

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
  let body = "";
  const abort = new FetchAbortController();
  const timer = setTimeout(() => abort.abort(new Error("timeout")), 1000);
  try {
    body = await apiRequest(q, abort.signal);
    clearTimeout(timer);
    source = "api";
  } catch (err) {
    console.error("apiRequest", err);
  }

  if (body === "") {
    body = await fallbackLogic(q);
    source = "fallback";
  }

  const res = new Response(body);
  res.headers.set("Access-Control-Allow-Origin", "*");
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
    this.cap = url.searchParams.get("cap") || "udp";
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
    s.set("cap", this.cap);
    s.set("ipv4", this.ipv4 ? "1" : "0");
    s.set("ipv6", this.ipv6 ? "1" : "0");
    s.set("lon", `${this.lon}`);
    s.set("lat", `${this.lat}`);
    return s;
  }
}

/**
 * @param {Query} q
 * @param {AbortSignal} signal
 * @returns {Promise<string>}
 */
async function apiRequest(q, signal) {
  const req = new URL(API);
  for (const [k, v] of q.toSearchParams()) {
    req.searchParams.append(k, v);
  }

  const res = await abortableFetch(req, signal);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }

  return res.text();
}

/**
 * @param {Query} q
 * @returns {Promise<string>}
 */
async function fallbackLogic(q) {
  const pos = [q.lon, q.lat];
  const routers = await listRouters();
  const avail = routers.filter((router) => router[q.cap]);
  avail.sort((a, b) => {
    return distance(pos, a.position) - distance(pos, b.position);
  });
  return avail.slice(0, q.k).map((router) => router.host).join(",");
}
