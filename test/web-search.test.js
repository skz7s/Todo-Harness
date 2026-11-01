import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { Config, ModelWebSearch, SEARCH_PROVIDER_ID, SEARCH_USAGE_EVENT, apply, parseAnthropicSearch, parseDeepSeekSearch, parseGeminiSearch, parsePerplexitySearch, parseResponsesSearch, selectSearchBackend } from '../src/plugins/web-search.js';

const source = { url: 'https://example.com/article', title: 'Example' };
const searchCall = { type: 'web_search_call', id: 'search-1', status: 'completed', action: { type: 'search', sources: [source] } };
const outputText = { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Search context', annotations: [{ type: 'url_citation', ...source }] }] };

function fixture(profiles, config = {}, fetch) {
  const providers = Object.keys(profiles);
  let selection = { provider: providers[0], model: profiles[providers[0]].models?.[0]?.id ?? 'test-model' };
  const events = [];
  const resolvedRefs = [];
  const session = { requestContext: () => selection, append: (type, data) => events.push({ type, data }) };
  const namespaces = [
    { ns: 'llm-pi-ai', value: { providers: profiles } },
    { ns: 'agent-default-model', value: { provider: providers[0], model: 'default-model' } }
  ];
  const keys = { ROUTE_KEY: 'route-secret', DEEPSEEK_API_KEY: 'search-secret' };
  const ctx = {
    settings: { describe: () => namespaces },
    llm: { listConfigurableProviders: () => providers.map((provider) => ({ provider, settingsNs: 'llm-pi-ai', settingsPath: ['providers', provider] })) },
    get(name) {
      if (name === 'agents') return { currentInitiator: () => ({ session }) };
      if (name === 'credentials') return {
        resolve: async (ref) => { resolvedRefs.push(ref); return keys[ref] ? { value: keys[ref] } : undefined; },
        readRecord: async () => undefined
      };
    }
  };
  return { search: new ModelWebSearch(ctx, config, fetch), ctx, events, keys, resolvedRefs, session, select: (value) => { selection = value; } };
}

async function serverFixture(t, handler) {
  const server = createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  return `http://127.0.0.1:${server.address().port}/gateway/v1`;
}

test('search plugin registers one provider and supports live backend overrides', () => {
  const registrations = [];
  const config = Config({ backends: { gateway: 'deepseek', 'gateway/model': 'disabled' } });
  apply({ web: { registerSearchProvider: (provider) => registrations.push(provider) } }, config);
  assert.equal(registrations[0].id, SEARCH_PROVIDER_ID);
  assert.equal(registrations[0].available(), true);
  assert.equal(config.backends.get()['gateway/model'], 'disabled');
});

test('backend routing distinguishes protocols, DeepSeek and Perplexity rather than guessing from GPT names', () => {
  const cases = [
    [{ api: 'openai-responses' }, 'responses'],
    [{ api: 'anthropic-messages' }, 'anthropic'],
    [{ api: 'google-generative-ai' }, 'gemini'],
    [{ provider: 'perplexity', api: 'openai-completions' }, 'perplexity'],
    [{ baseURL: 'https://api.perplexity.ai', api: 'openai-completions' }, 'perplexity'],
    [{ provider: 'deepseek-account' }, 'deepseek'],
    [{ provider: 'deepseek-official' }, 'deepseek'],
    [{ provider: 'custom', baseURL: 'https://api.deepseek.com/v1', api: 'anthropic-messages' }, 'deepseek'],
    [{ model: 'gpt-6.1-sol', api: 'openai-completions' }, 'deepseek'],
    [{ api: 'bedrock-converse-stream' }, 'deepseek'],
    [{ api: 'openai-responses', backend: 'disabled' }, 'disabled'],
    [{ api: 'openai-completions', backend: 'responses' }, 'responses']
  ];
  for (const [route, backend] of cases) assert.equal(selectSearchBackend(route), backend);
});

test('Responses search sends a real built-in tool, consumes SSE and retains sources and usage', async (t) => {
  let received;
  const baseURL = await serverFixture(t, async (request, response) => {
    let text = '';
    for await (const chunk of request) text += chunk;
    received = { url: request.url, headers: request.headers, body: JSON.parse(text) };
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    const result = { status: 'completed', output: [searchCall, outputText], usage: { input_tokens: 50, output_tokens: 12, input_tokens_details: { cached_tokens: 20 } } };
    for (const event of [
      { type: 'response.output_item.done', output_index: 0, item: searchCall },
      { type: 'response.completed', response: result }
    ]) response.write(`event: ${event.type}\r\ndata: ${JSON.stringify(event)}\r\n\r\n`);
    response.end();
  });
  const f = fixture({ gateway: { api: 'openai-responses', baseURL, apiKeyEnv: 'ROUTE_KEY', headers: { 'x-relay-id': 'tenant-1' } } });
  const result = await f.search.search({ query: 'official documentation', maxResults: 4 });
  assert.equal(received.url, '/gateway/v1/responses');
  assert.equal(received.headers.authorization, 'Bearer route-secret');
  assert.equal(received.headers['x-relay-id'], 'tenant-1');
  assert.deepEqual(received.body.tools, [{ type: 'web_search' }]);
  assert.deepEqual(received.body.tool_choice, { type: 'web_search' });
  assert.deepEqual(received.body.include, ['web_search_call.action.sources']);
  assert.equal(received.body.model, 'test-model');
  assert.equal(received.body.store, false);
  assert.deepEqual(result.sources, [source]);
  assert.equal(result.content, 'Search context');
  assert.deepEqual(f.events, [{ type: SEARCH_USAGE_EVENT, data: { provider: 'gateway', model: 'test-model', inputTokens: 30, outputTokens: 12, cacheReadTokens: 20, cacheWriteTokens: 0, totalTokens: 62 } }]);
});

test('an endpoint that ignores native search cannot pass with an ordinary model answer', () => {
  assert.throws(() => parseResponsesSearch([outputText]), /no completed web_search_call/);
  assert.throws(() => parseResponsesSearch([{ ...searchCall, status: 'failed' }]), /no completed/);
  assert.deepEqual(parseResponsesSearch([{ ...searchCall, action: { type: 'search' } }, outputText]).sources, [source]);
  assert.equal(parseResponsesSearch([searchCall, { ...outputText, content: [{ type: 'output_text', text: 'x', annotations: [{ type: 'url_citation', url: 'javascript:alert(1)' }] }] }]).sources.length, 1);
});

test('Anthropic Messages uses native search blocks, citations and cache-aware usage', async () => {
  let request;
  const f = fixture({ claude: { api: 'anthropic-messages', baseURL: 'https://relay.example/anthropic/v1', apiKeyEnv: 'ROUTE_KEY' } }, {}, async (url, options) => {
    request = { url, ...options, body: JSON.parse(options.body) };
    return Response.json({
      content: [
        { type: 'web_search_tool_result', content: [{ type: 'web_search_result', ...source, page_age: '2026-10-30' }] },
        { type: 'text', text: 'Model prose', citations: [{ url: source.url, cited_text: 'Cited passage' }] }
      ], usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 20, cache_creation_input_tokens: 3 }
    });
  });
  const result = await f.search.search({ query: 'search' });
  assert.equal(request.url, 'https://relay.example/anthropic/v1/messages');
  assert.equal(request.headers.get('x-api-key'), 'route-secret');
  assert.equal(request.headers.get('anthropic-version'), '2023-06-01');
  assert.equal(request.body.tools[0].type, 'web_search_20250305');
  assert.deepEqual(result.sources, [{ ...source, snippet: 'Cited passage', publishedAt: '2026-10-30' }]);
  assert.equal(result.content, undefined);
  assert.deepEqual(f.events[0].data, { provider: 'claude', model: 'test-model', inputTokens: 10, outputTokens: 5, cacheReadTokens: 20, cacheWriteTokens: 3, totalTokens: 38 });
  assert.throws(() => parseAnthropicSearch({ content: [{ type: 'text', text: 'Pretend search' }] }), /no web_search_tool_result/);
  assert.throws(() => parseAnthropicSearch({ content: [{ type: 'web_search_tool_result', content: { error_code: 'unavailable' } }] }), /unavailable/);
});

test('Gemini uses Google Search and maps grounded citations', async () => {
  let request;
  const f = fixture({ google: {} }, {}, async (url, options) => {
    request = { url, ...options, body: JSON.parse(options.body) };
    return Response.json({ candidates: [{ content: { parts: [{ text: 'Grounded answer' }] }, groundingMetadata: { groundingChunks: [{ web: { uri: source.url, title: source.title } }] } }] });
  });
  f.keys.GEMINI_API_KEY = 'gemini-secret';
  f.select({ provider: 'google', model: 'gemini-2.5-flash' });
  const result = await f.search.search({ query: 'search' });
  assert.match(request.url, /\/v1beta\/models\/gemini-2\.5-flash:generateContent$/);
  assert.equal(request.headers.get('x-goog-api-key'), 'gemini-secret');
  assert.deepEqual(request.body.tools, [{ google_search: {} }]);
  assert.deepEqual(result.sources, [source]);
  assert.throws(() => parseGeminiSearch({ candidates: [{ content: { parts: [{ text: 'No grounding' }] } }] }), /no Google Search/);
});

test('Perplexity receives its actual model and returns structured sources or URL citations', async () => {
  let request;
  const f = fixture({ perplexity: { apiKeyEnv: 'ROUTE_KEY', api: 'openai-completions', baseURL: 'https://api.perplexity.ai' } }, {}, async (url, options) => {
    request = { url, ...options, body: JSON.parse(options.body) };
    return Response.json({ citations: [source.url], choices: [{ message: { content: 'Search answer' } }] });
  });
  f.select({ provider: 'perplexity', model: 'sonar-pro' });
  assert.deepEqual((await f.search.search({ query: 'search' })).sources, [{ url: source.url }]);
  assert.equal(request.body.model, 'sonar-pro');
  assert.equal(request.url, 'https://api.perplexity.ai/chat/completions');
  assert.equal(request.headers.get('authorization'), 'Bearer route-secret');
  assert.throws(() => parsePerplexitySearch({ choices: [] }), /no Perplexity/);
});

test('ordinary Completions and unsupported protocols use independent DeepSeek Search without sending relay credentials', async () => {
  const requests = [];
  const f = fixture({ local: { api: 'openai-completions', baseURL: 'https://local.example/v1', apiKeyEnv: 'ROUTE_KEY' } }, {}, async (url, options) => {
    requests.push({ url, ...options, body: JSON.parse(options.body) });
    return Response.json({ results: [{ ...source, summary: 'Long summary', snippet: 'Short snippet', date: null }] });
  });
  const result = await f.search.search({ query: 'search', maxResults: 3 });
  assert.equal(requests[0].url, 'https://api.deepseek.com/v1/tools/search');
  assert.equal(requests[0].headers.get('authorization'), 'Bearer search-secret');
  assert.deepEqual(requests[0].body, { query: 'search', count: 3, need_content: false });
  assert.deepEqual(f.resolvedRefs, ['DEEPSEEK_API_KEY']);
  assert.deepEqual(result.sources, [{ ...source, snippet: 'Long summary' }]);
  assert.deepEqual(parseDeepSeekSearch({ results: [] }), { sources: [], truncated: false });
  delete f.keys.DEEPSEEK_API_KEY;
  await assert.rejects(f.search.search({ query: 'search' }), (error) => error.code === 'WEB_PROVIDER_CREDENTIAL_MISSING');
  assert.equal(requests.length, 1);
});

test('search route is captured per call and tracks model, credentials and live overrides after a switch', async () => {
  const requests = [];
  const config = { backends: { get: () => overrides } };
  let overrides = {};
  const f = fixture({
    first: { api: 'openai-completions', baseURL: 'https://one.example/v1', apiKeyEnv: 'ROUTE_KEY' },
    second: { api: 'anthropic-messages', baseURL: 'https://two.example/v1', apiKeyEnv: 'SECOND_KEY' }
  }, config, async (url, options) => {
    requests.push({ url, headers: options.headers, body: JSON.parse(options.body) });
    if (url.includes('deepseek.com')) return Response.json({ results: [] });
    return Response.json({ content: [{ type: 'web_search_tool_result', content: [] }] });
  });
  f.keys.SECOND_KEY = 'second-secret';
  await f.search.search({ query: 'first query' });
  f.select({ provider: 'second', model: 'second-model' });
  await f.search.search({ query: 'second query' });
  assert.equal(requests[1].body.model, 'second-model');
  assert.equal(requests[1].headers.get('x-api-key'), 'second-secret');
  overrides = { second: 'disabled', 'second/second-model': 'deepseek' };
  await f.search.search({ query: 'third query' });
  assert.equal(requests[2].url, 'https://api.deepseek.com/v1/tools/search');
  f.select({ provider: 'second', model: 'other-model' });
  await assert.rejects(f.search.search({ query: 'fourth query' }), /disabled/);
  assert.equal(requests.length, 3);
});

test('DeepSeek account authentication uses its token only for endpoints approved by the account service', async () => {
  let request;
  const f = fixture({ 'deepseek-account': {} }, {}, async (url, options) => {
    request = options;
    return Response.json({ results: [] });
  });
  const original = f.ctx.get;
  f.ctx.get = (name) => name === 'deepseekAccount' ? { resolveToken: async (endpoint) => endpoint.startsWith('https://api.deepseek.com/') ? 'account-token' : undefined } : original(name);
  await f.search.search({ query: 'search' });
  assert.equal(request.headers.get('x-dsh-auth-token'), 'account-token');
  assert.equal(request.headers.get('authorization'), null);
  assert.deepEqual(f.resolvedRefs, []);
});

test('cancellation prevents dispatch and HTTP failures do not silently use another backend', async () => {
  let count = 0;
  const f = fixture({ claude: { api: 'anthropic-messages', baseURL: 'https://relay.example/v1', apiKeyEnv: 'ROUTE_KEY' } }, {}, async () => { count++; return new Response('invalid key', { status: 401 }); });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(f.search.search({ query: 'search' }, controller.signal));
  assert.equal(count, 0);
  await assert.rejects(f.search.search({ query: 'search' }), (error) => error.code === 'WEB_PROVIDER_ERROR' && error.message.includes('HTTP 401') && !error.message.includes('route-secret'));
  assert.equal(count, 1);
});

test('cancel during a request is surfaced as WEB_ABORTED and cancels the transport', async () => {
  let started;
  const ready = new Promise((resolve) => { started = resolve; });
  const f = fixture({ claude: { api: 'anthropic-messages', baseURL: 'https://relay.example/v1', apiKeyEnv: 'ROUTE_KEY' } }, {}, async (_url, { signal }) => {
    started();
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  });
  const controller = new AbortController();
  const promise = f.search.search({ query: 'search' }, controller.signal);
  await ready;
  controller.abort();
  await assert.rejects(promise, (error) => error.code === 'WEB_ABORTED');
});

test('Responses stream must complete, and provider output caps respect model compatibility', async (t) => {
  let body;
  const baseURL = await serverFixture(t, async (request, response) => {
    let text = '';
    for await (const chunk of request) text += chunk;
    body = JSON.parse(text);
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.end(`data: ${JSON.stringify({ type: 'response.output_item.done', output_index: 0, item: searchCall })}\n\n`);
  });
  const f = fixture({ gateway: { api: 'openai-responses', baseURL, apiKeyEnv: 'ROUTE_KEY', models: [{ id: 'test-model', compat: { supportsMaxOutputTokens: false } }] } });
  await assert.rejects(f.search.search({ query: 'search' }), /ended without a completed response/);
  assert.equal(body.max_output_tokens, undefined);
});

test('search sources are deduplicated and bounded, and DeepSeek rejects oversized Unicode queries', async () => {
  const f = fixture({ local: { api: 'openai-completions', baseURL: 'https://local.example/v1' } }, {}, async () => Response.json({ results: [source, source, { url: 'https://example.org' }] }));
  const result = await f.search.search({ query: 'search', maxResults: 1 });
  assert.deepEqual(result.sources, [source]);
  assert.equal(result.truncated, true);
  await assert.rejects(f.search.search({ query: '字'.repeat(129) }), /128 Unicode/);
});
