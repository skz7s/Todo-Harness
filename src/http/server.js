import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const BRAND_MARK_PATH = new URL('./assets/brand-mark.png', import.meta.url);

export function createTodoServer({ repository, usageRepository, settingsRepository, host = '127.0.0.1', port = 0, allowedOrigin, logger = console } = {}) {
  if (!repository || !usageRepository || !settingsRepository || !allowedOrigin) throw new TypeError('repository, usageRepository, settingsRepository, and allowedOrigin are required');
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) throw new Error('TODO_HARNESS_MUST_BIND_LOOPBACK');
  const server = createServer(async (request, response) => {
    try {
      await route(request, response, { repository, usageRepository, settingsRepository, allowedOrigin });
    } catch (error) {
      if (error instanceof TypeError || error instanceof RangeError || error instanceof SyntaxError) {
        if (!response.headersSent) json(response, 400, { error: error.message }, originHeaders(request, allowedOrigin));
        return;
      }
      if (error.statusCode && !response.headersSent) {
        json(response, error.statusCode, { error: error.code ?? 'request failed' }, originHeaders(request, allowedOrigin));
        return;
      }
      logger.error?.('[todo-harness-api]', error);
      if (!response.headersSent) json(response, 500, { error: 'internal error' }, originHeaders(request, allowedOrigin));
    }
  });
  return {
    server,
    async listen() {
      await new Promise((resolveListen, reject) => {
        server.once('error', reject);
        server.listen(port, host, resolveListen);
      });
      return server.address();
    },
    async close() {
      server.closeAllConnections?.();
      await new Promise((resolveClose) => server.close(resolveClose));
    }
  };
}

async function route(request, response, { repository, usageRepository, settingsRepository, allowedOrigin }) {
  const origin = request.headers.origin;
  const headers = originHeaders(request, allowedOrigin);
  if (origin !== allowedOrigin) return json(response, 403, { error: 'origin not allowed' });
  if (request.method === 'OPTIONS') {
    response.writeHead(204, { ...headers, 'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '600' });
    response.end();
    return;
  }
  const url = new URL(request.url ?? '/', allowedOrigin);
  if (url.pathname === '/api/todos' && request.method === 'POST') {
    return json(response, 201, { todo: await repository.create(await readJson(request)) }, headers);
  }
  const todoMatch = url.pathname.match(/^\/api\/todos\/([^/]+)$/);
  if (todoMatch && request.method === 'PATCH') {
    return json(response, 200, { todo: await repository.update(decodeURIComponent(todoMatch[1]), await readJson(request)) }, headers);
  }
  if (todoMatch && request.method === 'DELETE') {
    return json(response, 200, { todo: await repository.remove(decodeURIComponent(todoMatch[1])) }, headers);
  }
  const completeMatch = url.pathname.match(/^\/api\/todos\/([^/]+)\/complete$/);
  if (completeMatch && request.method === 'POST') {
    return json(response, 200, { todo: await repository.complete(decodeURIComponent(completeMatch[1])) }, headers);
  }
  if (request.method === 'PUT' && url.pathname === '/api/settings') {
    const body = await readJson(request);
    const keys = Object.keys(body);
    if (keys.some((key) => !['agentName', 'dailyTokenBudget'].includes(key))) throw new TypeError('settings contain an unknown field');
    return json(response, 200, await settingsRepository.update(body), headers);
  }
  if (request.method !== 'GET') return json(response, 405, { error: 'method not allowed' }, { ...headers, allow: 'GET, POST, PUT, PATCH, DELETE, OPTIONS' });

  if (url.pathname === '/api/health') return json(response, 200, { ok: true, name: 'todo-harness' }, headers);
  if (url.pathname === '/api/brand-mark') return png(response, 200, await readFile(BRAND_MARK_PATH), headers);
  if (url.pathname === '/api/todos') {
    return json(response, 200, { todos: await repository.list({ includeArchived: true }), stats: await repository.stats() }, headers);
  }
  if (url.pathname === '/api/usage') return json(response, 200, await usageRepository.usage(), headers);
  if (url.pathname === '/api/settings') return json(response, 200, await settingsRepository.get(), headers);
  return json(response, 404, { error: 'not found' }, headers);
}

async function readJson(request) {
  let source = '';
  for await (const chunk of request) {
    source += chunk;
    if (source.length > 16384) throw new RangeError('request payload is too large');
  }
  const value = JSON.parse(source || '{}');
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('settings payload must be an object');
  return value;
}

function originHeaders(request, allowedOrigin) {
  if (request.headers.origin !== allowedOrigin) return {};
  return { 'access-control-allow-origin': allowedOrigin, vary: 'Origin' };
}

function json(response, status, value, cors = {}) {
  response.writeHead(status, {
    ...cors,
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff'
  });
  response.end(JSON.stringify(value));
}

function png(response, status, value, cors = {}) {
  response.writeHead(status, {
    ...cors,
    'cache-control': 'no-store',
    'content-type': 'image/png',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff'
  });
  response.end(value);
}
