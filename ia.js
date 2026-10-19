// Chama a IA escolhida para gerar as linhas do caderno de erros. Só roda quando o usuário pede.
// A chave de cada IA fica só neste aparelho (IndexedDB), fora do backup e da sincronização.
// Claude vai pelo SDK oficial, carregado do CDN só na hora de usar; Gemini, OpenAI e DeepSeek, pela API HTTP de cada um.

const SDK_CLAUDE = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.135.0/+esm';
export const PROVEDORES = { claude: 'Claude (Anthropic)', gemini: 'Gemini (Google)', openai: 'OpenAI', deepseek: 'DeepSeek' };
export const MODELO_PADRAO = { claude: 'claude-opus-5-5' };

// tipo: chave (chave recusada), limite (cota ou crédito), rede (sem conexão), recusa (a IA recusou), outro
// chave, limite e rede param a fila inteira; recusa e outro só marcam o pedido como falho
export class ErroIA extends Error { constructor(msg, tipo) { super(msg); this.tipo = tipo; } }
export const paraTudo = e => ['chave', 'limite', 'rede'].includes(e?.tipo);

let sdk = null;
async function anthropic() {
  try { return (sdk ??= (await import(SDK_CLAUDE)).default); }
  catch { sdk = null; throw new ErroIA('Não consegui carregar o SDK do Claude (sem internet?).', 'rede'); }
}
// chave criada fora de um workspace exige o cabeçalho anthropic-workspace-id em todo pedido
const clienteClaude = async cfg => new (await anthropic())({ apiKey: cfg.key, dangerouslyAllowBrowser: true, maxRetries: 2,
  ...(cfg.ws ? { defaultHeaders: { 'anthropic-workspace-id': cfg.ws } } : {}) });
async function erroClaude(e) {
  const A = await anthropic();
  if (/not scoped to a workspace/i.test(String(e?.message))) return new ErroIA('Esta chave não pertence a um workspace: preencha o "ID do workspace" em Mais › IA (começa com wrkspc_) ou crie a chave dentro de um workspace no Console.', 'chave');
  if (e instanceof A.AuthenticationError || e instanceof A.PermissionDeniedError) return new ErroIA('Chave do Claude recusada. Confira em Mais › IA.', 'chave');
  if (e instanceof A.RateLimitError) return new ErroIA('Limite de uso do Claude atingido. Tente mais tarde.', 'limite');
  if (e instanceof A.APIConnectionError) return new ErroIA('Sem conexão com o Claude.', 'rede');
  if (e instanceof A.APIError) return new ErroIA(`Claude: erro ${e.status ?? ''} ${String(e.message || '').slice(0, 160)}`, 'outro');
  return e;
}
// fallback de recusa no servidor: só nos modelos que aceitam o formato "default"
const temFallback = m => /^claude-(opus-5|fable-5-1|sonnet-5-5)/.test(m);

async function claude(cfg, system, user) {
  const model = cfg.model || MODELO_PADRAO.claude, c = await clienteClaude(cfg);
  let r;
  try {
    r = await c.beta.messages.create({
      model, max_tokens: 16000,
      ...(temFallback(model) ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {}),
      output_config: { effort: 'medium' },
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: user }],
    });
  } catch (e) { throw await erroClaude(e); }
  if (r.stop_reason === 'refusal') throw new ErroIA(`O Claude recusou este pedido${r.stop_details?.category ? ' (' + r.stop_details.category + ')' : ''}.`, 'recusa');
  return r.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
}

async function http(url, opts, nome) {
  let r; try { r = await fetch(url, opts); } catch { throw new ErroIA(`Sem conexão com ${nome}.`, 'rede'); }
  const j = await r.json().catch(() => ({}));
  const msg = String(j.error?.message || j.message || '').slice(0, 160);
  if (r.status === 401 || r.status === 403 || (r.status === 400 && /api key/i.test(msg))) throw new ErroIA(`Chave do ${nome} recusada. Confira em Mais › IA.`, 'chave');
  if (r.status === 402 || r.status === 429) throw new ErroIA(`Limite de uso ou crédito do ${nome} esgotado. Tente mais tarde.`, 'limite');
  if (!r.ok) throw new ErroIA(`${nome}: erro ${r.status} ${msg}`, 'outro');
  return j;
}
const BASE_OAI = { openai: 'https://api.openai.com/v1', deepseek: 'https://api.deepseek.com' };
async function estiloOpenAI(prov, cfg, system, user) {
  const j = await http(`${BASE_OAI[prov]}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.key}` },
    body: JSON.stringify({ model: cfg.model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }) }, PROVEDORES[prov]);
  const ch = j.choices?.[0];
  if (ch?.finish_reason === 'content_filter') throw new ErroIA(`${PROVEDORES[prov]} recusou este pedido.`, 'recusa');
  return ch?.message?.content || '';
}
const GEM = 'https://generativelanguage.googleapis.com/v1beta';
async function gemini(cfg, system, user) {
  const j = await http(`${GEM}/models/${encodeURIComponent(cfg.model)}:generateContent`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': cfg.key },
    body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: user }] }] }) }, 'Gemini');
  const c = j.candidates?.[0];
  if (!c) throw new ErroIA(`O Gemini recusou este pedido${j.promptFeedback?.blockReason ? ' (' + j.promptFeedback.blockReason + ')' : ''}.`, 'recusa');
  return (c.content?.parts || []).map(p => p.text || '').join('');
}

// cfg = { prov, key, model }; devolve o texto da resposta (as linhas TAB do caderno)
export async function gerar(cfg, system, user) {
  if (!cfg?.key) throw new ErroIA('Falta a chave da API em Mais › IA.', 'chave');
  if (!cfg.model) throw new ErroIA('Falta escolher o modelo em Mais › IA.', 'outro');
  if (cfg.prov === 'claude') return claude(cfg, system, user);
  if (cfg.prov === 'gemini') return gemini(cfg, system, user);
  if (cfg.prov in BASE_OAI) return estiloOpenAI(cfg.prov, cfg, system, user);
  throw new ErroIA('IA desconhecida.', 'outro');
}

// modelos disponíveis para a chave, para o usuário escolher (evita digitar nome de modelo errado)
export async function listarModelos(cfg) {
  if (!cfg?.key) throw new ErroIA('Informe a chave primeiro.', 'chave');
  if (cfg.prov === 'claude') {
    const c = await clienteClaude(cfg); const ids = [];
    try { for await (const m of c.models.list()) ids.push(m.id); } catch (e) { throw await erroClaude(e); }
    return ids;
  }
  if (cfg.prov === 'gemini') {
    const j = await http(`${GEM}/models?pageSize=200`, { headers: { 'x-goog-api-key': cfg.key } }, 'Gemini');
    return (j.models || []).filter(m => (m.supportedGenerationMethods || []).includes('generateContent')).map(m => m.name.replace(/^models\//, ''));
  }
  if (cfg.prov in BASE_OAI) {
    const j = await http(`${BASE_OAI[cfg.prov]}/models`, { headers: { authorization: `Bearer ${cfg.key}` } }, PROVEDORES[cfg.prov]);
    return (j.data || []).map(m => m.id).sort();
  }
  return [];
}
