/**
 * dsh-gloss — host half.
 *
 * Registers two HTTP routes under `/api/gloss/` and resolves the model route
 * through a four-layer read-only probe. **Nothing here writes to the settings
 * service, the profile patch file, or any credential store.**
 *
 * Layers (all read-only):
 *   1. `body.model` supplied by the browser half (current session selection)
 *   2. `agentDefaultModel.currentSelection()`
 *   3. None available -> offline dictionary fallback
 *
 * The host never calls `agentDefaultModel.saveSelection()`.
 */
import { lookup, stats as dictStats } from './dict.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * In-memory explain cache. A hovered term is usually re-read several times in
 * the same conversation; the model call costs ~2s, so caching a successful
 * result by (word + sentence) makes repeat hovers effectively instant. This is
 * process-local and read-only with respect to the user's config.
 */
const EXPLAIN_CACHE = new Map();
const EXPLAIN_CACHE_TTL = 10 * 60 * 1000; // 10 minutes
const EXPLAIN_CACHE_MAX = 300;

function explainCacheKey(word, sentence) {
  const s = `${word.toLowerCase()}\u0000${sentence}`;
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = ((h * 31) | 0) + s.charCodeAt(i);
  return (h >>> 0).toString(36);
}

function getExplainCache(key) {
  const hit = EXPLAIN_CACHE.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > EXPLAIN_CACHE_TTL) {
    EXPLAIN_CACHE.delete(key);
    return null;
  }
  return hit.value;
}

function putExplainCache(key, value) {
  if (!value || value.error || (!value.domain && !value.context)) return;
  EXPLAIN_CACHE.delete(key);
  EXPLAIN_CACHE.set(key, { at: Date.now(), value });
  while (EXPLAIN_CACHE.size > EXPLAIN_CACHE_MAX) {
    const oldest = EXPLAIN_CACHE.keys().next().value;
    if (oldest === undefined) break;
    EXPLAIN_CACHE.delete(oldest);
  }
}

/**
 * Online dictionary cache (Youdao suggest). Keyed by lowercase word/phrase.
 * Process-local and read-only with respect to the user's config. Dictionary
 * definitions are stable, so a 24h TTL is plenty.
 */
const NET_CACHE = new Map();
const NET_CACHE_TTL = 24 * 60 * 60 * 1000;
const NET_CACHE_MAX = 500;

/**
 * Online Chinese dictionary lookup via Youdao's free jsonapi endpoint — no API
 * key, no model, ~40-120ms. Returns a COMPLETE (untruncated) explanation plus a
 * standard IPA, with technical senses ranked first (that is what the user is
 * usually reading). Falls back to null so the caller can use the offline dict.
 *
 * @param {string} word
 * @param {AbortSignal} signal
 * @returns {Promise<{text: string, phone: string}|null>}
 */
const TECH_RE = /计算机|网络|通信|人工智能|大语言模型|机器学习|深度学习|数学|编程|数据|并发|算法|令牌|词元|缓存|吞吐|软件|硬件|分布式|数据库|操作系统|自然语言处理|\bAI\b|\bNLP\b|编译|进程|线程/;
const GENERIC_RE = /医学|生物学|心理学|弗洛伊德| Freud/;

function rankTechnical(full) {
  const posMatch = full.match(/^(n|v|adj|adv|prep|conj|pron|int)\.\s*/);
  const pos = posMatch ? posMatch[0] : '';
  const body = posMatch ? full.slice(posMatch[0].length) : full;
  const parts = body.split(/[；;]/).map((s) => s.trim()).filter(Boolean);
  const scored = parts.map((p) => ({
    p,
    score: (TECH_RE.test(p) ? 2 : 0) - (GENERIC_RE.test(p) ? 1 : 0)
  }));
  scored.sort((a, b) => b.score - a.score); // stable: ties keep original order
  let out = pos + scored.map((x) => x.p).join('；');
  if (out.length > 180) out = out.slice(0, 180) + '…';
  return out;
}

async function netExplain(word, signal) {
  const url = 'https://dict.youdao.com/jsonapi?' + new URLSearchParams({
    q: word, doctype: 'json', jsonversion: '2'
  });
  const res = await fetch(url, {
    headers: { 'user-agent': 'Mozilla/5.0' },
    signal
  });
  if (!res.ok) throw new Error(`youdao http ${res.status}`);
  const json = await res.json();
  const words = json?.ec?.word;
  if (!Array.isArray(words) || !words.length) return null;
  const phone = String(words[0]?.usphone ?? words[0]?.ukphone ?? '');
  const defs = [];
  for (const w of words) {
    for (const trs of (w?.trs ?? [])) {
      for (const tr of (trs?.tr ?? [])) {
        let i = tr?.l?.i;
        if (Array.isArray(i)) i = i.join(' ');
        if (typeof i === 'string' && i.trim()) defs.push(i.trim());
      }
    }
  }
  const full = defs.join(' ').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  if (!full) return null;
  return { text: rankTechnical(full), phone };
}

/**
 * Shared prompt builder. Frames the term as a TECHNICAL glossary entry: the
 * dictionary headword is explicitly marked as a generic hint that must NOT be
 * literally translated. Verified against latency/token/throughput on the
 * user's gateway — outputs precise domain meanings instead of generic ones.
 */
function buildExplainMessages(prompt) {
  return [
    {
      role: 'system',
      content: '你是一个专业技术术语词典助手。像领域专家一样解释英文术语，只输出紧凑 JSON，不要任何多余文字或 markdown 代码块。'
    },
    {
      role: 'user',
      content: [
        `术语: ${prompt.word}`,
        `词典首义(通用义，仅作参考，切勿照搬直译): ${prompt.origin || '无'}`,
        `所在句子: "${prompt.sentence.slice(0, 240)}"`,
        '',
        '要求:',
        '- 判断该术语在这句话里所属的技术领域。',
        '- 给出中文的精确技术含义——教材/文档式定义，不要字面直译、不要口语化泛译。',
        '- 例: latency 不是"潜伏"，在计算领域是"延迟(请求到响应的时间差)"；token 不是"代币"，在 NLP 里是"分词后的基本处理单位"。',
        '- 上下文不足以判断领域时，domain 填 null。',
        '- 只输出 JSON，格式: {"domain":"中文领域标签或null","context":"精确技术含义，一句话，不超过60字"}'
      ].join('\n')
    }
  ];
}

/**
 * Read the user's gateway configuration from the profile patch file — read-only.
 * We intentionally parse only the two config blocks we need (llm-pi-ai
 * providers + agent-default-model selection) with a tiny line scanner instead
 * of a YAML dependency, so a malformed unrelated block cannot break us and we
 * never rewrite the file. Returns null when nothing is configured.
 *
 * @param {any} ctx
 * @returns {{baseURL: string, apiKey: string, model: string, provider: string} | null}
 */
function readGatewayConfig(ctx) {
  try {
    const profileContext = ctx.get('profileContext', false);
    const patchPath = profileContext?.patchPath;
    if (!patchPath) return null;
    const text = readFileSync(patchPath, 'utf8');

    // Locate the llm-pi-ai provider block, then the named provider's baseURL.
    // The patch file is a YAML list of `{id, config}` entries.
    const blocks = text.split(/^- /m).slice(1);
    let providerId = null;
    let baseURL = null;
    let apiKeyEnv = null;
    let model = null;
    let defaultProvider = null;
    let defaultModel = null;

    for (const block of blocks) {
      const idMatch = block.match(/^id:\s*['"]?([^\s'"]+)/);
      const id = idMatch?.[1] ?? '';
      if (id === 'agent-default-model') {
        defaultProvider = block.match(/provider:\s*['"]?([^\s'"]+)/)?.[1] ?? null;
        defaultModel = block.match(/model:\s*['"]?([^\s'"]+)/)?.[1] ?? null;
      }
      if (id === 'llm-pi-ai' && defaultProvider) {
        // Find the sub-block for the selected provider (2-space indent under providers).
        const providerRe = new RegExp(`^\\s+${defaultProvider}:\\s*$`, 'm');
        if (providerRe.test(block)) {
          const start = block.search(providerRe);
          const rest = block.slice(start);
          baseURL = rest.match(/baseURL:\s*['"]?([^\s'"]+)/)?.[1] ?? null;
          apiKeyEnv = rest.match(/apiKeyEnv:\s*['"]?([^\s'"]+)/)?.[1] ?? null;
          const modelRe = rest.match(/^\s*- id:\s*['"]?([^\s'"]+)/m);
          model = modelRe?.[1] ?? defaultModel;
        }
      }
    }

    providerId = defaultProvider;
    if (!providerId || !baseURL) return null;
    const apiKey = apiKeyEnv ? (process.env[apiKeyEnv] ?? '') : '';
    return {
      provider: providerId,
      baseURL,
      apiKey,
      model: model || defaultModel || 'auto'
    };
  } catch {
    return null;
  }
}

/**
 * Call the user's OpenAI-compatible gateway directly and stream the answer.
 * We bypass DSH's pi-ai adapter because it routes reasoning-model `content`
 * into the thinking stream (reasoning_content) and our collectText only sees
 * text-delta -> empty response. Setting reasoning_effort:"none" makes the
 * gateway emit clean content immediately. Returns parsed domain/context.
 *
 * @param {{baseURL: string, apiKey: string, model: string}} gw
 * @param {{word: string, sentence: string, origin: string}} prompt
 * @param {AbortSignal} signal
 * @returns {Promise<{domain: string|null, context: string|null, error: string|null}>}
 */
async function gatewayExplain(gw, prompt, signal) {
  const url = `${gw.baseURL.replace(/\/+$/, '')}/chat/completions`;
  const headers = { 'content-type': 'application/json' };
  if (gw.apiKey) headers.authorization = `Bearer ${gw.apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers,
    signal,
    body: JSON.stringify({
      model: gw.model,
      stream: true,
      max_tokens: 200,
      reasoning_effort: 'none',
      messages: buildExplainMessages(prompt)
    })
  });
  if (!res.ok) throw new Error(`gateway http ${res.status}`);
  if (!res.body) throw new Error('gateway no body');

  let raw = '';
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  for await (const bytes of res.body) {
    if (signal.aborted) break;
    buffer += decoder.decode(bytes, { stream: true });
    let nl;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') continue;
      try {
        const json = JSON.parse(data);
        const delta = json?.choices?.[0]?.delta;
        if (delta && typeof delta.content === 'string') raw += delta.content;
      } catch { /* skip non-json keepalive lines */ }
    }
  }
  return parseLlmJson(raw);
}

/**
 * Read a JSON body from a Node IncomingMessage with a hard size cap.
 * Mirrors the helper used by dsh-deepseek-account-platform (:248).
 *
 * @param {import("node:http").IncomingMessage} req
 * @param {number} limit
 * @returns {Promise<any>}
 */
async function readJsonBody(req, limit = 16384) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('payload too large'), { status: 413 });
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) return {};
  return JSON.parse(text);
}

/**
 * Write a JSON response. Always emits CORS so the browser half can reach the
 * host from the same origin without a proxy.
 *
 * @param {import("node:http").ServerResponse} res
 * @param {number} status
 * @param {any} payload
 */
function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'POST, GET, OPTIONS',
    'access-control-allow-headers': 'content-type'
  });
  res.end(body);
}

/**
 * Classify an error so the browser can pick the right UX without guessing.
 *
 * @param {unknown} error
 * @returns {'provider-missing' | 'timeout' | 'content-rejected' | 'unavailable'}
 */
function classify(error) {
  const text = String(error?.message ?? error ?? '');
  const lower = text.toLowerCase();
  if (lower.includes('timeout') || lower.includes('aborted') || lower.includes('abort')) return 'timeout';
  if (lower.includes('rejected') || lower.includes('content policy') || lower.includes('flagged')) return 'content-rejected';
  if (lower.includes('provider') || lower.includes('not found') || lower.includes('unknown model')) return 'provider-missing';
  return 'unavailable';
}

/**
 * Extract the plain-text payload from a streamed LLM response. The reference
 * plugin (dsh-session-title-llm) only collects text from `text-delta` chunks
 * and treats `finish.kind === "error"` as a terminal failure.
 *
 * @param {{ stream: (o:any) => AsyncIterable<any>, config: any }} call
 * @param {{word: string, sentence: string, origin: string}} prompt
 * @param {AbortSignal} signal
 * @returns {Promise<string>}
 */
async function collectText(call, prompt, signal) {
  let text = '';
  let sawError = false;
  const messages = buildExplainMessages(prompt);
  const options = { ...call.config, messages: [
    messages[0],
    { role: 'user', content: [{ type: 'text', text: messages[1].content }] }
  ], signal };
  for await (const chunk of call.stream(options)) {
    if (signal.aborted) break;
    if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') text += chunk.text;
    if (chunk?.type === 'finish' && chunk.finish?.kind === 'error') sawError = true;
  }
  if (sawError) throw new Error('gloss: content rejected by provider');
  return text;
}

/**
 * Parse the LLM JSON payload defensively. Models occasionally wrap the object
 * in prose or a markdown fence, so we strip both before parsing.
 *
 * @param {string} raw
 * @returns {{domain: string|null, context: string|null, error: string|null}}
 */
function parseLlmJson(raw) {
  if (!raw) return { domain: null, context: null, error: 'empty response' };
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fence) text = fence[1].trim();
  const brace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (brace !== -1 && lastBrace > brace) text = text.slice(brace, lastBrace + 1);
  try {
    const parsed = JSON.parse(text);
    return {
      domain: typeof parsed?.domain === 'string' && parsed.domain.trim() ? parsed.domain.trim().slice(0, 40) : null,
      context: typeof parsed?.context === 'string' && parsed.context.trim() ? parsed.context.trim().slice(0, 600) : null,
      error: null
    };
  } catch (error) {
    return { domain: null, context: null, error: error?.message ?? 'bad json' };
  }
}

/**
 * Probe one model route with a tiny call. Returns the parsed domain/context
 * or null on any failure — the plugin degrades instead of throwing.
 *
 * @param {any} ctx
 * @param {{provider: string, model: string, reasoningEffort?: string}} route
 * @param {{word: string, sentence: string, origin: string}} prompt
 * @param {AbortSignal} signal
 * @returns {Promise<{domain: string|null, context: string|null, error: string|null} | null>}
 */
async function probeRoute(ctx, route, prompt, signal) {
  try {
    const llm = ctx.get('llm');
    if (!llm) return { domain: null, context: null, error: 'llm-unavailable' };
    const call = await llm.prepareCall({
      provider: route.provider,
      model: route.model,
      maxTokens: 320,
      ...(route.reasoningEffort ? { reasoningEffort: route.reasoningEffort } : {})
    }, signal);
    const raw = await collectText(call, prompt, signal);
    const parsed = parseLlmJson(raw);
    if (parsed.error) return parsed;
    return { domain: parsed.domain, context: parsed.context, error: null };
  } catch (error) {
    return { domain: null, context: null, error: `${classify(error)}: ${error?.message ?? error}` };
  }
}

/**
 * Resolve a route candidate to `{provider, model, reasoningEffort?}`.
 *
 * @param {any} ctx
 * @param {any} candidate
 * @returns {{provider: string, model: string, reasoningEffort?: string} | null}
 */
function resolveRoute(ctx, candidate) {
  if (!candidate || typeof candidate.provider !== 'string' || typeof candidate.model !== 'string') return null;
  if (!candidate.provider || !candidate.model) return null;
  return {
    provider: candidate.provider,
    model: candidate.model,
    ...(candidate.reasoningEffort ? { reasoningEffort: candidate.reasoningEffort } : {})
  };
}

/**
 * Host plugin body.
 *
 * @param {any} ctx
 */
function apply(ctx) {
  ctx.effect(() => {
    try {
      ctx.webServer.register({
        kind: 'prefix',
        path: '/api/gloss/explain',
        handler: async (req, res) => {
          if (req.method === 'OPTIONS') {
            sendJson(res, 204, {});
            return;
          }
          if (req.method !== 'POST') {
            sendJson(res, 405, { error: 'method not allowed' });
            return;
          }
          let body;
          try {
            body = await readJsonBody(req);
          } catch (error) {
            sendJson(res, 413, { error: 'payload too large' });
            return;
          }
          const word = String(body?.word ?? '').trim();
          const sentence = String(body?.sentence ?? '').trim();
          if (!word || word.length > 80 || sentence.length > 2000) {
            sendJson(res, 400, { error: 'invalid request' });
            return;
          }

          // Serve a previously successful result instantly (<1ms) instead of
          // paying the ~2s model round-trip again for the same term+sentence.
          const cacheKey = explainCacheKey(word, sentence);
          let llm = getExplainCache(cacheKey);

          const controller = new AbortController();
          const deadline = setTimeout(() => controller.abort(), 12000);
          try {
            const origin = typeof body?.origin === 'string' && body.origin.trim() ? body.origin.trim() : '';
            const prompt = { word, sentence, origin };

            if (!llm) {
              // Primary: the user's own OpenAI-compatible gateway, called directly.
              // DSH's pi-ai adapter swallows reasoning-model `content` into the
              // thinking stream, so we bypass it entirely for the fast path.
              const gw = readGatewayConfig(ctx);
              if (gw) {
                try {
                  llm = await gatewayExplain(gw, prompt, controller.signal);
                } catch (error) {
                  llm = { domain: null, context: null, error: `${classify(error)}: ${error?.message ?? error}` };
                }
              }
              // Fallback: DSH llm adapter routes (browser selection -> default).
              if (!llm || llm.error) {
                const browserRoute = resolveRoute(ctx, body?.model);
                const agentDefaultModel = ctx.get('agentDefaultModel', false);
                const defaultRoute = agentDefaultModel
                  ? resolveRoute(ctx, agentDefaultModel.currentSelection?.())
                  : null;
                for (const route of [browserRoute, defaultRoute]) {
                  if (!route) continue;
                  llm = await probeRoute(ctx, route, prompt, controller.signal);
                  if (llm && !llm.error) break;
                }
              }
              putExplainCache(cacheKey, llm);
            }

            const dict = lookup(word);
            const response = {
              word,
              ipa: dict?.ipa ?? '',
              pos: dict?.pos ?? '',
              origin: origin || dict?.definition || '',
              domain: llm?.domain ?? null,
              context: llm?.context ?? null,
              source: llm && !llm.error ? 'llm' : 'dict',
              error: llm?.error ?? null
            };
            sendJson(res, 200, response);
          } catch (error) {
            const status = error?.status === 413 ? 413 : 500;
            sendJson(res, status, {
              error: 'gloss failed',
              reason: classify(error),
              detail: String(error?.message ?? error)
            });
          } finally {
            clearTimeout(deadline);
          }
        }
      });

      // Instant lookup. Online Chinese dictionary first (~80ms, technical
      // senses included), offline ECDICT as instant fallback. No model call.
      // IPA/pos come from the offline dictionary; the Chinese explanation
      // comes from Youdao. Result is cached in-process for 24h.
      ctx.webServer.register({
        kind: 'exact',
        path: '/api/gloss/quick',
        handler: async (req, res) => {
          const url = new URL(req.url, 'http://localhost');
          const word = (url.searchParams.get('word') ?? '').trim();
          if (!word || word.length > 80) {
            sendJson(res, 400, { error: 'invalid request' });
            return;
          }
          const key = word.toLowerCase();
          const dict = lookup(key);
          const cached = NET_CACHE.get(key);
          if (cached && Date.now() - cached.at <= NET_CACHE_TTL) {
            sendJson(res, 200, {
              word,
              ipa: cached.phone || dict?.ipa || '',
              pos: dict?.pos ?? '',
              origin: cached.text,
              source: 'net'
            });
            return;
          }

          // Online first with a hard timeout; fall back to offline on any error.
          const controller = new AbortController();
          const deadline = setTimeout(() => controller.abort(), 1500);
          let hit = null;
          let source = 'dict';
          try {
            hit = await netExplain(word, controller.signal);
            if (hit) {
              source = 'net';
              NET_CACHE.delete(key);
              NET_CACHE.set(key, { at: Date.now(), text: hit.text, phone: hit.phone });
              while (NET_CACHE.size > NET_CACHE_MAX) {
                const oldest = NET_CACHE.keys().next().value;
                if (oldest === undefined) break;
                NET_CACHE.delete(oldest);
              }
            }
          } catch { /* offline fallback below */ } finally {
            clearTimeout(deadline);
          }
          sendJson(res, 200, {
            word,
            ipa: hit?.phone || dict?.ipa || '',
            pos: dict?.pos ?? '',
            origin: hit?.text || dict?.definition || '',
            source
          });
        }
      });

      ctx.webServer.register({
        kind: 'exact',
        path: '/api/gloss/health',
        handler: (_req, res) => {
          const dict = dictStats();
          sendJson(res, 200, {
            ok: true,
            dictEntries: dict.entries,
            dictFailure: dict.failure,
            hasAgentDefaultModel: Boolean(ctx.get('agentDefaultModel', false))
          });
        }
      });
    } catch (error) {
      // Route registration is best-effort. A duplicate path means another
      // plugin owns /api/gloss/ — degrade to offline-only instead of failing
      // the whole profile.
      ctx.logger?.warn?.(`dsh-gloss: route registration skipped: ${error?.message ?? error}`);
    }
  }, 'dsh-gloss.host');
}

export { apply };
export const inject = ['webServer'];
