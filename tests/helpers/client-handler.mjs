/**
 * Minimal request/response harness for the public serverless handler.
 *
 * Vercel calls api/index.js with Node IncomingMessage/ServerResponse objects, so
 * the harness reproduces just the shape the handler touches: method, url,
 * headers, an async-iterable body, and the status/json/redirect response API.
 * That keeps the tests on the real routing code without a running server.
 */

/** Signs a session token exactly the way api/index.js does. */
export async function signToken(payload, secret = process.env.SESSION_SECRET) {
  const crypto = await import('node:crypto');
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

/** Decodes a token's payload without verifying it (test inspection only). */
export function decodeToken(token) {
  return JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString());
}

function createResponse() {
  const state = {
    status: null,
    body: null,
    redirectTo: null,
    headers: {},
    raw: '',
  };

  const response = {
    statusCode: 200,
    setHeader(key, value) { state.headers[key.toLowerCase()] = value; },
    getHeader(key) { return state.headers[key.toLowerCase()]; },
    removeHeader(key) { delete state.headers[key.toLowerCase()]; },
    status(code) { state.status = code; return this; },
    json(payload) { state.body = payload; return this; },
    send(payload) { state.body = payload; return this; },
    end(payload) { if (payload) state.raw += payload; return this; },
    redirect(target) { state.redirectTo = target; return this; },
    write(chunk) { state.raw += chunk; return this; },
  };

  return { response, state };
}

/**
 * Invokes the public handler and resolves once the response is written.
 *
 * @param {object} handler default export of api/index.js
 * @param {string} method HTTP method
 * @param {string} url path with optional query string
 * @param {{headers?: object, body?: any}} options
 */
export async function callHandler(handler, method, url, { headers = {}, body } = {}) {
  const { response, state } = createResponse();

  const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))];
  const request = {
    method,
    url,
    headers: {
      host: 'test.local',
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    socket: {},
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk;
    },
  };

  await handler(request, response);
  // Let any trailing async work settle before assertions run.
  await new Promise((resolve) => setImmediate(resolve));
  return state;
}
