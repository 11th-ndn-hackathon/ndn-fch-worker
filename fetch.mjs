/**
 * @implements {AbortController}
 */
export class FetchAbortController {
  constructor() {
    this.signal = new FetchAbortSignal();
  }

  abort() {
    this.signal.aborted = true;
    this.signal.callback();
  }
}

/**
 * @implements {AbortSignal}
 */
export class FetchAbortSignal {
  constructor() {
    this.aborted = false;
    this.callback = () => {};
  }
}

/**
 * @param {Request} req
 * @param {AbortSignal} signal
 * @returns {Promise<Response>}
 */
export function abortableFetch(req, signal) {
  return Promise.race([
    fetch(req),
    new Promise((resolve, reject) => {
      if (signal instanceof FetchAbortSignal) {
        signal.callback = reject;
        if (signal.aborted) {
          reject();
        }
      }
    }),
  ]);
}
