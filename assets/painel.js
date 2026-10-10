// Painel de Resultados: abre o arquivo cifrado com a chave que vem no link (depois do #)
// e monta a visão do gestor (todos os clientes) ou a visão de um cliente.
(() => {
  'use strict';

  const MODO = document.body.dataset.modo === 'cliente' ? 'cliente' : 'gerente';
  const app = document.getElementById('app');
  const TZ = 'America/Sao_Paulo';

  // ---------- Tema e modo embutido (menu lateral do GHL) ----------
  // Dentro de um iframe (ex.: link no menu lateral do GHL) abre no tema claro, como o GHL.
  // ?tema=claro ou ?tema=escuro no link força um dos dois.
  const EMBUTIDO = (() => { try { return window.self !== window.top; } catch (e) { return true; } })();
  (() => {
    let t = '';
    try { t = (new URLSearchParams(location.search).get('tema') || '').toLowerCase(); } catch (e) { t = ''; }
    const raiz = document.documentElement;
    if (t === 'escuro' || t === 'dark') raiz.dataset.theme = 'dark';
    else if (t === 'claro' || t === 'light' || (!t && EMBUTIDO)) raiz.dataset.theme = 'light';
    if (EMBUTIDO) raiz.classList.add('embutido');
  })();

  // ---------- DOM ----------
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : String(v));
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || kid === false || kid === '') continue;
      el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }
  function svg(tag, attrs) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, String(v));
    return el;
  }
  const ICONES = {
    crit: 'M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm-.75 3.5h1.5v5h-1.5v-5Zm0 6.25h1.5v1.5h-1.5v-1.5Z',
    warn: 'M8 1.5 15 14H1L8 1.5Zm-.75 4.5v4h1.5V6h-1.5Zm0 5.25v1.5h1.5v-1.5h-1.5Z',
    info: 'M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm-.75 3h1.5v1.5h-1.5V4Zm0 3h1.5v5h-1.5V7Z',
    ok: 'M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm3.2 4.6 1.06 1.06L7 11.92 3.74 8.66 4.8 7.6 7 9.8l4.2-4.2Z'
  };
  const ROTULO_SEV = { crit: 'Crítico', warn: 'Atenção', info: 'Aviso', ok: 'Tudo certo' };
  function selo(sev, texto) {
    const s = svg('svg', { viewBox: '0 0 16 16', 'aria-hidden': 'true' });
    s.append(svg('path', { fill: 'currentColor', d: ICONES[sev] || ICONES.info }));
    return h('span', { class: 'sev ' + sev }, s, texto || ROTULO_SEV[sev]);
  }
  const envolve = (itens) => [].concat(itens).flat(Infinity).filter((x) => x != null && x !== '' && x !== false).map((x) => (x.nodeType ? x : h('span', null, String(x))));

  // ---------- Formatos ----------
  const nf0 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
  const nf1 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });
  const nf1f = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const nf2 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  let MOEDA = 'BRL';
  function moeda(v, dec) {
    if (v == null || !isFinite(v)) return '–';
    const d = dec != null ? dec : (Math.abs(v) >= 1000 ? 0 : 2);
    try { return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: MOEDA, minimumFractionDigits: d, maximumFractionDigits: d }).format(v); }
    catch (e) { return nf2.format(v); }
  }
  const inteiro = (v) => (v == null || !isFinite(v) ? '–' : nf0.format(v));
  const pct = (v) => (v == null || !isFinite(v) ? '–' : nf1.format(v * 100) + '%');
  const vezes = (v) => (v == null || !isFinite(v) ? '–' : nf1f.format(v) + 'x');
  const div = (a, b) => (a == null || b == null || !b ? null : a / b);
  const plural = (n, um, muitos) => inteiro(n) + ' ' + (n === 1 ? um : muitos);

  function delta(cur, prev, dir) {
    if (cur == null || prev == null || !isFinite(cur) || !isFinite(prev)) return null;
    if (prev === 0 && cur === 0) return null;
    if (prev === 0) return { txt: 'novo', cls: 'flat', seta: '' };
    const r = (cur - prev) / prev;
    if (Math.abs(r) < 0.005) return { txt: 'igual', cls: 'flat', seta: '' };
    const sobe = r > 0;
    const cls = dir === 0 ? 'flat' : ((sobe ? dir : -dir) > 0 ? 'good' : 'bad');
    return { txt: nf0.format(Math.abs(r * 100)) + '%', cls, seta: sobe ? '▲' : '▼' };
  }
  function deltaEl(d) { return d ? h('span', { class: 'delta ' + d.cls }, (d.seta ? d.seta + ' ' : '') + d.txt) : null; }

  // ---------- Datas ----------
  function addDias(iso, n) { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function diasEntre(a, b) { return Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000) + 1; }
  const primeiroDoMes = (iso) => iso.slice(0, 8) + '01';
  const ddmm = (iso) => iso.slice(8, 10) + '/' + iso.slice(5, 7);
  const faixaTxt = (a, b) => (a === b ? ddmm(a) : ddmm(a) + ' a ' + ddmm(b));
  const fmtSemana = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', weekday: 'short' });
  const semana = (iso) => fmtSemana.format(new Date(iso + 'T12:00:00Z')).replace('.', '');
  const fmtQuando = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  function quando(iso) {
    const p = fmtQuando.formatToParts(new Date(iso));
    const g = (t) => (p.find((x) => x.type === t) || {}).value || '';
    return g('day') + '/' + g('month') + ' às ' + g('hour') + ':' + g('minute');
  }
  // Horários da atualização automática, iguais ao cron do workflow (minuto 7 das 0h às 2h e das 9h às 23h UTC,
  // ou seja, de hora em hora das 6h às 23h em Brasília). Dá 75 minutos de folga para atrasos do próprio GitHub.
  const HORAS_UTC = [0, 1, 2, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23];
  function atualizacaoAtrasada(geradoEm, agora = new Date()) {
    const esperado = new Date(agora.getTime() - 75 * 60000);
    if (esperado.getUTCMinutes() < 7) esperado.setUTCHours(esperado.getUTCHours() - 1);
    esperado.setUTCMinutes(7, 0, 0);
    for (let i = 0; i < 24 && !HORAS_UTC.includes(esperado.getUTCHours()); i++) esperado.setUTCHours(esperado.getUTCHours() - 1);
    return Date.parse(geradoEm) < esperado.getTime() - 5 * 60000;
  }
  function textoFresh(geradoEm) {
    const atrasada = atualizacaoAtrasada(geradoEm);
    return { atrasada, texto: 'Dados de ' + quando(geradoEm) + (atrasada ? ' · a atualização automática está atrasada' : ' · atualiza de hora em hora') };
  }
  const PERIODOS = [
    { k: 'hoje', t: 'Hoje' }, { k: 'ontem', t: 'Ontem' }, { k: '7d', t: '7 dias' },
    { k: 'mes', t: 'Mês atual' }, { k: '30d', t: '30 dias' }, { k: 'mesant', t: 'Mês anterior' }
  ];
  function faixas(hoje) {
    const ontem = addDias(hoje, -1);
    const def = {
      hoje: [hoje, hoje], ontem: [ontem, ontem], '7d': [addDias(ontem, -6), ontem],
      mes: primeiroDoMes(hoje) <= ontem ? [primeiroDoMes(hoje), ontem] : null,
      '30d': [addDias(ontem, -29), ontem],
      mesant: (() => { const fim = addDias(primeiroDoMes(hoje), -1); return [primeiroDoMes(fim), fim]; })()
    };
    const out = {};
    for (const [k, f] of Object.entries(def)) {
      if (!f) continue;
      const L = diasEntre(f[0], f[1]);
      out[k] = { k, L, cur: { s: f[0], e: f[1] }, prev: k === 'hoje' ? null : { s: addDias(f[0], -L), e: addDias(f[0], -1) } };
    }
    return out;
  }

  // ---------- Preferências do navegador ----------
  function lePref(k, padrao) { try { return localStorage.getItem('painel.' + MODO + '.' + k) || padrao; } catch (e) { return padrao; } }
  function gravaPref(k, v) { try { localStorage.setItem('painel.' + MODO + '.' + k, v); } catch (e) { /* sem armazenamento */ } }

  // ---------- Link e arquivo cifrado ----------
  function lerLink() {
    // A chave vem depois do #. Se alguma ferramenta tirar o #, também aceita ?k=<código>.
    const tenta = (txt) => {
      let s = '';
      try { s = decodeURIComponent(txt || '').trim(); } catch (e) { s = ''; }
      const m = s.match(/^([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]{43})(?![A-Za-z0-9_-])/);
      return m ? { id: m[1], chave: m[2] } : null;
    };
    let k = null;
    try { k = new URLSearchParams(location.search).get('k'); } catch (e) { k = null; }
    return tenta((location.hash || '').slice(1)) || tenta(k);
  }
  function bytes64(s) {
    const t = s.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(t + '==='.slice((t.length + 3) % 4));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  async function baixa(cred) {
    if (!window.crypto || !crypto.subtle || typeof DecompressionStream === 'undefined') throw new Error('navegador');
    let r;
    try { r = await fetch('../dados/' + cred.id + '.bin?v=' + Date.now(), { cache: 'no-store' }); }
    catch (e) { throw new Error('rede'); }
    if (r.status === 404) throw new Error('sumiu');
    if (!r.ok) throw new Error('rede');
    const buf = new Uint8Array(await r.arrayBuffer());
    if (buf.length < 30 || buf[0] !== 1) throw new Error('chave');
    let claro;
    try {
      const chave = await crypto.subtle.importKey('raw', bytes64(cred.chave), { name: 'AES-GCM' }, false, ['decrypt']);
      claro = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf.slice(1, 13) }, chave, buf.slice(13));
    } catch (e) { throw new Error('chave'); }
    const fluxo = new Blob([claro]).stream().pipeThrough(new DecompressionStream('gzip'));
    return JSON.parse(await new Response(fluxo).text());
  }

  // ---------- Base64 e texto ----------
  function b64deBytes(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  const b64url = (bytes) => b64deBytes(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const textoParaB64 = (txt) => b64deBytes(new TextEncoder().encode(txt));
  function b64ParaTexto(b64) {
    const bin = atob(String(b64 || '').replace(/\s/g, ''));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(out);
  }
  const normaliza = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

  // ---------- Token do GitHub do gestor (para editar a lista de clientes pelo painel) ----------
  // Fica guardado neste navegador cifrado com a chave do link do gestor: sem o link, não abre.
  function criaCofre(cred) {
    const ROTULO = 'painel.gerente.github';
    const enc = new TextEncoder();
    let emMemoria = null;
    async function chave() {
      const ikm = await crypto.subtle.importKey('raw', bytes64(cred.chave), 'HKDF', false, ['deriveKey']);
      return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: enc.encode('painel-resultados'), info: enc.encode('token-github') },
        ikm, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    }
    return {
      async le() {
        if (emMemoria) return emMemoria;
        let bruto = null;
        try { bruto = localStorage.getItem(ROTULO); } catch (e) { bruto = null; }
        if (!bruto) return null;
        try {
          const { iv, ct } = JSON.parse(bruto);
          const claro = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes64(iv) }, await chave(), bytes64(ct));
          emMemoria = new TextDecoder().decode(claro);
          return emMemoria;
        } catch (e) { return null; }
      },
      async grava(token) {
        emMemoria = token;
        try {
          const iv = crypto.getRandomValues(new Uint8Array(12));
          const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await chave(), enc.encode(token)));
          localStorage.setItem(ROTULO, JSON.stringify({ iv: b64url(iv), ct: b64url(ct) }));
        } catch (e) { /* sem armazenamento: vale só enquanto esta aba estiver aberta */ }
      },
      esquece() {
        emMemoria = null;
        try { localStorage.removeItem(ROTULO); } catch (e) { /* nada guardado */ }
      }
    };
  }

  // Lê e grava config/clientes.json pelo GitHub (o salvamento dispara a atualização do painel)
  function criaGithub(repo, token) {
    const url = 'https://api.github.com/repos/' + repo + '/contents/config/clientes.json';
    const cab = { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    const erro = (texto, tipo) => Object.assign(new Error(texto), { tipo });
    async function pede(metodo, corpo) {
      let r;
      try {
        r = await fetch(metodo === 'GET' ? url + '?ref=main&t=' + Date.now() : url, {
          method: metodo, cache: 'no-store',
          headers: corpo ? Object.assign({ 'Content-Type': 'application/json' }, cab) : cab,
          body: corpo ? JSON.stringify(corpo) : undefined
        });
      } catch (e) { throw erro('Sem conexão com o GitHub. Confira a internet e tente de novo.', 'rede'); }
      if (r.status === 401) throw erro('Esse token do GitHub não vale mais. Conecte de novo com um token novo.', 'token');
      if (r.status === 403 || r.status === 404) throw erro('O token não tem permissão para editar o repositório ' + repo + '. Confira se ele foi criado só para esse repositório com Contents em Read and write.', 'token');
      if (r.status === 409) throw erro('A lista mudou enquanto você editava.', 'conflito');
      if (!r.ok) throw erro('O GitHub respondeu com erro ' + r.status + '. Tente de novo em instantes.', 'outro');
      return r.json();
    }
    return {
      async le() {
        const j = await pede('GET');
        return { cfg: JSON.parse(b64ParaTexto(j.content)), sha: j.sha };
      },
      async grava(cfg, sha, mensagem) {
        const j = await pede('PUT', { message: mensagem, content: textoParaB64(JSON.stringify(cfg, null, 2) + '\n'), sha, branch: 'main' });
        return j.content && j.content.sha;
      }
    };
  }

  // "1500", "1.500", "1.500,50" ou "1500.5" viram número; vazio ou inválido vira null
  function valorEmReais(s) {
    let t = String(s || '').trim().replace(/[R$\s]/g, '');
    if (!t) return null;
    if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
    else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
    const n = Number(t);
    return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
  }

  function criaSlug(nome, usados) {
    let base = normaliza(nome).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 36) || 'cliente';
    let s = base, i = 2;
    while (usados.has(s)) s = base + '-' + i++;
    return s;
  }

  // ---------- Cálculos ----------
  const META_CAMPOS = ['inv', 'impr', 'cliques', 'leads', 'conversas', 'conv3', 'lpv'];
  const GHL_CAMPOS = ['opp', 'ag', 'cp', 'vd', 'rc', 'vdF', 'rcF'];
  function soma(dias, s, e) {
    const t = {}, tem = {};
    for (const k of META_CAMPOS.concat(GHL_CAMPOS)) t[k] = 0;
    for (const r of dias) {
      if (r.d < s || r.d > e) continue;
      for (const k in t) { const v = r[k]; if (typeof v === 'number') { t[k] += v; tem[k] = true; } }
    }
    for (const k of GHL_CAMPOS) if (!tem[k]) t[k] = null;
    t.inv = Math.round(t.inv * 100) / 100;
    if (t.rc != null) t.rc = Math.round(t.rc * 100) / 100;
    t.contatos = t.leads + t.conversas;
    return t;
  }
  function tipoResultado(ind) {
    const s = String(ind || '').toLowerCase();
    if (/messaging|conversation/.test(s)) return { key: 'conversas', um: 'conversa', muitos: 'conversas', contato: true };
    if (/lead/.test(s)) return { key: 'leads', um: 'lead', muitos: 'leads', contato: true };
    if (/profile_visit|profile visit/.test(s)) return { key: 'perfil', um: 'visita ao perfil', muitos: 'visitas ao perfil' };
    if (/follow/.test(s)) return { key: 'seguidores', um: 'seguidor', muitos: 'seguidores' };
    if (/landing_page_view|landing page/.test(s)) return { key: 'lpv', um: 'visita na página', muitos: 'visitas na página' };
    if (/link_click|link click/.test(s)) return { key: 'cliques', um: 'clique no link', muitos: 'cliques no link' };
    if (/purchase/.test(s)) return { key: 'compras', um: 'compra', muitos: 'compras' };
    if (/thruplay|video/.test(s)) return { key: 'video', um: 'visualização de vídeo', muitos: 'visualizações de vídeo' };
    if (/reach/.test(s)) return { key: 'alcance', um: 'pessoa alcançada', muitos: 'pessoas alcançadas' };
    if (/engagement|interaction/.test(s)) return { key: 'engaj', um: 'engajamento', muitos: 'engajamentos' };
    return { key: s || 'outros', um: 'resultado', muitos: 'resultados' };
  }
  const rotuloRes = (t, n) => (n === 1 ? t.um : t.muitos);
  function tipoPrincipal(camps) {
    for (const b of ['cur', 'prev']) {
      const por = new Map();
      for (const c of camps) {
        if (!c.ind || !(c[b].inv > 0)) continue;
        const t = tipoResultado(c.ind);
        const g = por.get(t.key) || { tipo: t, inv: 0 };
        g.inv += c[b].inv;
        por.set(t.key, g);
      }
      let melhor = null;
      for (const g of por.values()) if (!melhor || g.inv > melhor.inv) melhor = g;
      if (melhor) return melhor.tipo;
    }
    return null;
  }
  function somaTipo(camps, b, key) {
    let inv = 0, res = 0;
    for (const c of camps) if (c.ind && tipoResultado(c.ind).key === key) { inv += c[b].inv; res += c[b].res; }
    return { inv, res, custo: res > 0 ? inv / res : null };
  }
  function calcula(cli, pk, hoje) {
    const f = faixas(hoje)[pk];
    if (!f) return null;
    const cur = soma(cli.dias, f.cur.s, f.cur.e);
    const prev = f.prev ? soma(cli.dias, f.prev.s, f.prev.e) : null;
    const pr = (cli.periodos || {})[pk] || null;
    const camps = pr ? pr.campanhas : null;
    const tipo = camps ? tipoPrincipal(camps) : null;
    const curT = tipo ? somaTipo(camps, 'cur', tipo.key) : null;
    const prevT = tipo && prev ? somaTipo(camps, 'prev', tipo.key) : null;
    let cs = 0, cr = 0, cs0 = 0, cr0 = 0;
    if (camps) for (const c of camps) if (tipoResultado(c.ind).contato) { cs += c.cur.inv; cr += c.cur.res; cs0 += c.prev.inv; cr0 += c.prev.res; }
    return {
      f, cur, prev, camps, tipo, curT, prevT, cs, cr, cs0, cr0,
      custoContato: camps ? div(cs, cr) : div(cur.inv, cur.contatos),
      custoContato0: prev ? (camps ? div(cs0, cr0) : div(prev.inv, prev.contatos)) : null,
      alcance: pr && pr.alcance ? pr.alcance : null,
      freq: pr && pr.impr && pr.alcance ? [div(pr.impr[0], pr.alcance[0]), div(pr.impr[1], pr.alcance[1])] : null
    };
  }

  // ---------- Gráfico de colunas ----------
  function topoBonito(mx, inteiros) {
    if (!(mx > 0)) return inteiros ? 2 : 10;
    const passos = inteiros ? [1, 2, 4, 5, 10] : [1, 2, 2.5, 5, 10];
    const pot = Math.pow(10, Math.floor(Math.log10(mx)));
    for (const s of passos) if (s * pot >= mx) return inteiros ? Math.max(2, Math.ceil(s * pot)) : s * pot;
    return 10 * pot;
  }
  function colunaPath(x, y0, w, alt) {
    const r = Math.min(4, w / 2, alt);
    return 'M' + x + ',' + y0 + 'V' + (y0 - alt + r) + 'Q' + x + ',' + (y0 - alt) + ' ' + (x + r) + ',' + (y0 - alt) +
      'H' + (x + w - r) + 'Q' + (x + w) + ',' + (y0 - alt) + ' ' + (x + w) + ',' + (y0 - alt + r) + 'V' + y0 + 'Z';
  }
  const tip = h('div', { class: 'tip', hidden: true, role: 'presentation' });
  document.body.append(tip);
  function mostraTip(ev, valor, rotulo) { tip.replaceChildren(h('b', null, valor), h('span', null, rotulo)); tip.hidden = false; posTip(ev); }
  function posTip(ev) {
    const w = tip.offsetWidth || 120, hh = tip.offsetHeight || 40;
    let x = ev.clientX + 14, y = ev.clientY - hh - 10;
    if (x + w > window.innerWidth - 8) x = ev.clientX - w - 14;
    if (y < 8) y = ev.clientY + 16;
    tip.style.left = x + 'px';
    tip.style.top = y + 'px';
  }
  const escondeTip = () => { tip.hidden = true; };
  function grafico(cont, dias, chave, fmt, serie, titulo, inteiros) {
    const W = Math.max(260, Math.floor(cont.clientWidth || 360));
    const H = 168, pl = 56, pr = 6, pt = 10, pb = 24;
    const vals = dias.map((d) => d[chave] || 0);
    const topo = topoBonito(Math.max(0, ...vals), inteiros);
    const pw = W - pl - pr, ph = H - pt - pb;
    const banda = pw / Math.max(1, dias.length);
    const bw = Math.max(2, Math.min(24, banda - 2));
    const s = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, width: W, height: H, role: 'img', 'aria-label': titulo });
    const ticks = inteiros && topo % 2 ? [0, topo] : [0, topo / 2, topo];
    for (const tk of ticks) {
      const y = pt + ph - (tk / topo) * ph;
      s.append(svg('line', { x1: pl, x2: W - pr, y1: y, y2: y, class: tk === 0 ? 'base' : 'grid' }));
      const tx = svg('text', { x: pl - 8, y: y + 4, 'text-anchor': 'end', class: 'tick' });
      tx.textContent = fmt(tk, true);
      s.append(tx);
    }
    const y0 = pt + ph;
    dias.forEach((d, i) => {
      const v = vals[i];
      const x = pl + i * banda + (banda - bw) / 2;
      const alt = topo ? (v / topo) * ph : 0;
      let barra = null;
      if (alt > 0) { barra = svg('path', { d: colunaPath(+x.toFixed(2), +y0.toFixed(2), +bw.toFixed(2), +Math.max(1, alt).toFixed(2)), class: 'bar ' + serie }); s.append(barra); }
      const hit = svg('rect', { x: (pl + i * banda).toFixed(2), y: pt, width: Math.max(1, banda).toFixed(2), height: ph, fill: 'transparent', class: 'hit' });
      hit.addEventListener('pointerenter', (ev) => { if (barra) barra.classList.add('hl'); mostraTip(ev, fmt(v, false), ddmm(d.d) + ' · ' + semana(d.d) + (d.parcial ? ' (até agora)' : '')); });
      hit.addEventListener('pointermove', posTip);
      hit.addEventListener('pointerleave', () => { if (barra) barra.classList.remove('hl'); escondeTip(); });
      s.append(hit);
    });
    const idx = dias.length > 2 ? [0, Math.floor((dias.length - 1) / 2), dias.length - 1] : dias.map((_, i) => i);
    for (const i of idx) {
      const fim = i === dias.length - 1, ini = i === 0;
      const x = ini ? pl + i * banda + (banda - bw) / 2 : fim ? pl + i * banda + (banda + bw) / 2 : pl + i * banda + banda / 2;
      const tx = svg('text', { x: x.toFixed(2), y: H - 6, 'text-anchor': ini ? 'start' : fim ? 'end' : 'middle', class: 'tick' });
      tx.textContent = ddmm(dias[i].d);
      s.append(tx);
    }
    cont.replaceChildren(s);
  }
  function diasDoPeriodo(cli, f, hoje) {
    // Gráfico usa o período escolhido quando tem 7 dias ou mais; senão, os últimos 14 dias completos
    const ontem = addDias(hoje, -1);
    const s = f.L >= 7 && f.prev ? f.cur.s : addDias(ontem, -13);
    const e = f.L >= 7 && f.prev ? f.cur.e : ontem;
    const mapa = new Map(cli.dias.map((r) => [r.d, r]));
    const out = [];
    for (let d = s; d <= e; d = addDias(d, 1)) {
      const r = mapa.get(d) || { d };
      out.push({ d, inv: r.inv || 0, contatos: (r.leads || 0) + (r.conversas || 0), opp: r.opp || 0, ag: r.ag || 0 });
    }
    return { s, e, dias: out };
  }
  function blocoGraficos(cli, f, hoje, comGhl) {
    const { s, e, dias } = diasDoPeriodo(cli, f, hoje);
    const series = [
      { k: 'inv', t: 'Investimento por dia', c: 's1', fmt: (v, eixo) => moeda(v, eixo ? 0 : 2), int: false },
      { k: 'contatos', t: MODO === 'cliente' ? 'Contatos recebidos por dia' : 'Contatos no Meta por dia', c: 's2', fmt: (v) => inteiro(v), int: true }
    ];
    if (comGhl) series.push({ k: 'opp', t: MODO === 'cliente' ? 'Atendimentos abertos por dia' : 'Oportunidades no CRM por dia', c: 's3', fmt: (v) => inteiro(v), int: true });
    const grade = h('div', { class: 'charts', style: '--cols:' + Math.min(series.length, 3) });
    const pendentes = [];
    for (const sr of series) {
      const total = dias.reduce((a, d) => a + d[sr.k], 0);
      const plot = h('div', { class: 'plot' });
      grade.append(h('div', { class: 'chart' }, h('div', { class: 'ch' }, h('h3', null, sr.t), h('span', null, 'total ' + (sr.k === 'inv' ? moeda(total) : inteiro(total)))), plot));
      pendentes.push(() => grafico(plot, dias, sr.k, sr.fmt, sr.c, sr.t, sr.int));
    }
    const tabela = h('table', null,
      h('thead', null, h('tr', null, h('th', { class: 'l', scope: 'col' }, 'Dia'), series.map((sr) => h('th', { scope: 'col' }, sr.t.replace(' por dia', ''))))),
      h('tbody', null, dias.map((d) => h('tr', null, h('td', { class: 'l' }, ddmm(d.d) + ' ' + semana(d.d)), series.map((sr) => h('td', null, sr.k === 'inv' ? moeda(d.inv, 2) : inteiro(d[sr.k])))))));
    const bloco = h('div', { class: 'dsec' },
      h('div', { class: 'row' }, h('h3', null, 'Dia a dia'), h('span', { class: 'hint' }, faixaTxt(s, e))),
      grade,
      h('details', { class: 'days' }, h('summary', null, 'Ver os dias em tabela'), h('div', { class: 'tablewrap' }, tabela)));
    return { bloco, desenhar: () => pendentes.forEach((fn) => fn()) };
  }

  // ---------- Peças comuns ----------
  // Recado opcional que vem junto com os dados (ex.: demonstração, manutenção)
  const avisoEl = (d) => (d && d.aviso ? h('section', { class: 'notice info', role: 'status' }, h('p', null, d.aviso)) : null);
  function tile(lbl, val, sub, off) {
    return h('div', { class: 'tile' + (off ? ' off' : '') }, h('span', { class: 'lbl' }, lbl), h('span', { class: 'val' }, val), h('span', { class: 'sub' }, envolve(sub)));
  }
  function mini(lbl, val, sub, off) {
    return h('div', { class: 'mini' + (off ? ' off' : '') }, h('span', { class: 'lbl' }, lbl), h('span', { class: 'val' }, val), h('span', { class: 'sub' }, envolve(sub)));
  }
  function celula(valor, d, unidade, cls) {
    return h('td', { class: cls || null }, h('span', { class: 'v' }, valor), d ? h('span', { class: 'd' }, d) : null, unidade ? h('span', { class: 'u' }, unidade) : null);
  }
  const STATUS_CAMP = {
    ACTIVE: ['ativa', 'Ativa'], PAUSED: ['pausada', 'Pausada'], CAMPAIGN_PAUSED: ['pausada', 'Pausada'], ADSET_PAUSED: ['pausada', 'Conjuntos pausados'],
    IN_PROCESS: ['pausada', 'Em processamento'], WITH_ISSUES: ['prob', 'Com problema'], DISAPPROVED: ['prob', 'Reprovada'],
    PENDING_REVIEW: ['pausada', 'Em análise'], PENDING_BILLING_INFO: ['prob', 'Pagamento pendente']
  };
  function tabelaCampanhas(m, opcoes) {
    const comConta = opcoes && opcoes.comConta;
    const lista = (m.camps || []).filter((c) => c.cur.inv > 0 || c.prev.inv > 0 || (STATUS_CAMP[c.status] || [])[0] === 'prob');
    if (!lista.length) return h('div', { class: 'tablewrap' }, h('div', { class: 'empty-state' }, 'Nenhuma campanha investiu neste período.'));
    const temPrev = !!m.prev;
    return h('div', { class: 'tablewrap' }, h('table', null,
      h('thead', null, h('tr', null,
        h('th', { class: 'l', scope: 'col' }, 'Campanha'), comConta ? h('th', { class: 'l', scope: 'col' }, 'Conta') : null,
        h('th', { class: 'l', scope: 'col' }, 'Situação'), h('th', { scope: 'col' }, 'Investimento'), h('th', { scope: 'col' }, 'Resultado'),
        h('th', { scope: 'col' }, 'Custo por resultado'), opcoes && opcoes.orcamento ? h('th', { scope: 'col' }, 'Orçamento por dia') : null)),
      h('tbody', null, lista.map((c) => {
        const st = STATUS_CAMP[c.status] || ['pausada', c.status ? c.status.toLowerCase() : '–'];
        const t = tipoResultado(c.ind);
        const custo = c.cur.res > 0 ? c.cur.inv / c.cur.res : null;
        const custo0 = c.prev.res > 0 ? c.prev.inv / c.prev.res : null;
        return h('tr', null,
          h('td', { class: 'l' }, c.nome),
          comConta ? h('td', { class: 'l muted' }, c.conta || '') : null,
          h('td', { class: 'l' }, h('span', { class: 'status ' + st[0] }, h('span', { class: 'dot' }), st[1])),
          celula(moeda(c.cur.inv), deltaEl(delta(c.cur.inv, temPrev ? c.prev.inv : null, 0))),
          celula(inteiro(c.cur.res), deltaEl(delta(c.cur.res, temPrev ? c.prev.res : null, 1)), c.ind ? rotuloRes(t, c.cur.res) : null),
          celula(custo != null ? moeda(custo, 2) : '–', deltaEl(delta(custo, temPrev ? custo0 : null, -1))),
          opcoes && opcoes.orcamento ? h('td', null, c.orc ? moeda(c.orc, 2) : h('span', { class: 'muted', title: 'Orçamento definido nos conjuntos de anúncios' }, 'nos conjuntos')) : null);
      }))));
  }
  function seletorPeriodo(estado, permitidos, hoje, aoTrocar) {
    const fx = faixas(hoje);
    return h('div', { class: 'seg', role: 'group', 'aria-label': 'Escolha o período' },
      PERIODOS.filter((p) => permitidos.includes(p.k)).map((p) => h('button', {
        type: 'button', 'aria-pressed': String(p.k === estado.pk), disabled: !fx[p.k],
        title: fx[p.k] ? null : 'Ainda não há dias completos neste mês',
        onclick: () => aoTrocar(p.k)
      }, p.t)));
  }
  function faixaEl(f) {
    return h('div', { class: 'range' }, h('b', null, faixaTxt(f.cur.s, f.cur.e)), f.prev ? ' comparado com ' + faixaTxt(f.prev.s, f.prev.e) : ' · dia em andamento, sem comparação');
  }
  function etapa(n, t, x, cls) {
    return h('div', { class: 'etapa ' + (cls || '') }, h('span', { class: 'n' }, n), h('span', { class: 't' }, t), x ? h('span', { class: 'x' }, x) : null);
  }

  // ---------- Estados de erro ----------
  const TEXTO_ERRO = {
    link: ['Link incompleto', 'Abra o link completo que você recebeu. Ele termina com um código depois do símbolo #.'],
    sumiu: MODO === 'cliente'
      ? ['Este link não está mais ativo', 'Peça um link novo para quem cuida da sua conta.']
      : ['Arquivo do gestor não encontrado', 'Rode a atualização no GitHub ou gere o link de novo na página de acesso.'],
    chave: ['Este link não abre mais os dados', MODO === 'cliente' ? 'Peça um link novo para quem cuida da sua conta.' : 'O segredo dos links mudou. Gere o link de novo na página de acesso.'],
    rede: ['Não foi possível carregar agora', 'Confira a conexão com a internet e tente de novo.'],
    navegador: ['Navegador sem suporte', 'Abra este link num navegador atualizado (Chrome, Safari, Edge ou Firefox).']
  };
  function mostraErro(codigo, tentar) {
    const [titulo, texto] = TEXTO_ERRO[codigo] || TEXTO_ERRO.rede;
    app.replaceChildren(
      h('header', { class: 'top' }, h('div', null, h('p', { class: 'eyebrow' }, MODO === 'cliente' ? 'Resultados de tráfego pago' : 'Visão do gestor'), h('h1', null, 'Painel de Resultados'))),
      h('section', { class: 'notice warn', role: 'alert' }, h('h2', null, titulo), h('p', null, texto), tentar ? h('div', null, h('button', { class: 'btn', type: 'button', onclick: tentar }, 'Tentar de novo')) : null)
    );
  }

  // =====================================================================
  // Visão do gestor
  // =====================================================================
  const STATUS_CONTA = {
    DISABLED: 'Conta desativada pela Meta', UNSETTLED: 'Pagamento pendente: anúncios parados até quitar',
    PENDING_RISK_REVIEW: 'Conta em análise de risco pela Meta', PENDING_SETTLEMENT: 'Pagamento em processamento',
    IN_GRACE_PERIOD: 'Conta em período de carência de pagamento', PENDING_CLOSURE: 'Conta em processo de encerramento', CLOSED: 'Conta encerrada'
  };
  const PROBLEMA = { WITH_ISSUES: ['crit', 'Campanha com problema de veiculação'], DISAPPROVED: ['crit', 'Campanha com anúncio reprovado'], PENDING_BILLING_INFO: ['crit', 'Campanha parada por pendência de pagamento'] };

  function alertasDe(cli, m, pk) {
    const L = [];
    const add = (sev, oque, det) => L.push({ sev, slug: cli.slug, quem: cli.cliente.nome, oque, det: det || '' });
    for (const c of cli.contas) {
      if (c.erro) { add('warn', 'Não foi possível ler a conta ' + c.nome, c.erro); continue; }
      if (c.status && c.status !== 'ACTIVE' && c.status !== 'ANY_ACTIVE') {
        add(['DISABLED', 'UNSETTLED', 'CLOSED', 'PENDING_CLOSURE'].includes(c.status) ? 'crit' : 'warn', (STATUS_CONTA[c.status] || 'Situação da conta na Meta: ' + c.status) + ' (' + c.nome + ')', c.motivo ? 'Motivo informado pela Meta: ' + c.motivo : '');
      }
      if (c.limite && c.limite.teto > 0 && c.limite.gasto >= 0.9 * c.limite.teto) add('warn', 'Conta perto do limite de gastos (' + c.nome + ')', moeda(c.limite.gasto, 0) + ' de ' + moeda(c.limite.teto, 0));
    }
    if (m) {
      const { cur, prev, tipo, curT, prevT } = m;
      if (prev && prev.inv > 0 && cur.inv === 0) add('warn', 'Parou de investir', moeda(prev.inv) + ' no período anterior e nada neste');
      if (tipo && curT && pk !== 'hoje' && curT.inv > 0 && curT.res === 0) {
        const ref = prevT && prevT.res > 0 ? prevT.inv / prevT.res : null;
        if ((ref && curT.inv >= ref) || (!ref && m.f.L >= 7)) add('crit', 'Investiu ' + moeda(curT.inv) + ' sem gerar ' + tipo.muitos, ref ? 'No período anterior, cada ' + tipo.um + ' custou ' + moeda(ref, 2) : '');
      }
      if (tipo && curT && prevT && curT.res >= 3 && prevT.res >= 3) {
        const c1 = curT.inv / curT.res, c0 = prevT.inv / prevT.res;
        if (c0 > 0 && (c1 - c0) / c0 > 0.3) add('warn', 'Custo por ' + tipo.um + ' subiu ' + nf0.format((c1 - c0) / c0 * 100) + '%', moeda(c0, 2) + ' para ' + moeda(c1, 2));
      }
      if (m.camps) for (const c of m.camps) { const p = PROBLEMA[c.status]; if (p) add(p[0], p[1], c.nome); }
      const g = cli.ghl;
      if (g.conectado) {
        for (const a of g.avisos || []) add('warn', 'Ajuste no GHL', a);
        if (pk !== 'hoje' && cur.contatos >= 10 && cur.opp != null && cur.opp < 0.5 * cur.contatos) {
          add('warn', 'Só ' + inteiro(cur.opp) + ' de ' + inteiro(cur.contatos) + ' contatos do Meta viraram oportunidade no CRM', 'Confira a automação que cria a oportunidade e o filtro de origem do cliente');
        }
      }
    }
    if (!cli.ghl.conectado && cli.ghl.motivo && cli.ghl.motivo !== 'não configurado') add('warn', 'GHL não foi lido', cli.ghl.motivo);
    return L;
  }

  function totais(clis, pk, hoje) {
    const t = { inv: 0, inv0: 0, cont: 0, cont0: 0, cs: 0, cr: 0, cs0: 0, cr0: 0, n: 0, n0: 0, ghl: 0, invG: 0, invG0: 0, contG: 0, contG0: 0, opp: 0, opp0: 0, ag: null, ag0: null, cp: null, cp0: null, vd: 0, vd0: 0, rc: 0, rc0: 0, outra: 0, temPrev: false };
    const mais = (a, b) => (b == null ? a : (a == null ? b : a + b));
    for (const cli of clis) {
      const m = calcula(cli, pk, hoje);
      if (!m) continue;
      if (cli.cliente.moeda !== MOEDA) { if (m.cur.inv > 0) t.outra++; continue; }
      t.temPrev = !!m.prev;
      t.inv += m.cur.inv; t.cont += m.cur.contatos; if (m.cur.inv > 0) t.n++;
      t.cs += m.cs; t.cr += m.cr;
      if (m.prev) { t.inv0 += m.prev.inv; t.cont0 += m.prev.contatos; t.cs0 += m.cs0; t.cr0 += m.cr0; if (m.prev.inv > 0) t.n0++; }
      if (cli.ghl.conectado) {
        t.ghl++; t.invG += m.cur.inv; t.contG += m.cur.contatos;
        t.opp += m.cur.opp || 0; t.ag = mais(t.ag, m.cur.ag); t.cp = mais(t.cp, m.cur.cp); t.vd += m.cur.vd || 0; t.rc += m.cur.rc || 0;
        if (m.prev) { t.invG0 += m.prev.inv; t.contG0 += m.prev.contatos; t.opp0 += m.prev.opp || 0; t.ag0 = mais(t.ag0, m.prev.ag); t.cp0 = mais(t.cp0, m.prev.cp); t.vd0 += m.prev.vd || 0; t.rc0 += m.prev.rc || 0; }
      }
    }
    // Sem quebra por campanha (Hoje), o custo por contato usa todo o investimento
    if (pk === 'hoje') { t.cs = t.inv; t.cr = t.cont; }
    return t;
  }

  function iniciaGerente(dados, cred, acelera) {
    MOEDA = (dados.clientes[0] && dados.clientes[0].cliente.moeda) || 'BRL';
    const estado = { pk: lePref('periodo', '7d'), todos: false, aberto: null, foco: null, dados, filtro: lePref('filtro', 'ativos'), busca: '' };
    if (!['ativos', 'inativos', 'todos'].includes(estado.filtro)) estado.filtro = 'ativos';
    const GER = '*gerenciar*'; // gaveta aberta no modo "Gerenciar clientes"

    // Busca por nome: esconde o que não bate, sem redesenhar a página (o campo continua com o foco)
    function aplicaBusca() {
      const q = normaliza(estado.busca);
      app.querySelectorAll('[data-nome]').forEach((el) => { el.hidden = !!q && !normaliza(el.dataset.nome).includes(q); });
      app.querySelectorAll('[data-grupo]').forEach((g) => {
        const temItens = !!g.querySelector('[data-nome]');
        const visivel = !!g.querySelector('[data-nome]:not([hidden])');
        g.hidden = !!q && !visivel;
        if (q && visivel && g.tagName === 'DETAILS') g.open = true;
        if (!q && !temItens) g.hidden = false;
      });
      const nada = app.querySelector('.clientes .sem-resultado');
      if (nada) nada.hidden = !q || !!app.querySelector('.clientes [data-nome]:not([hidden])');
    }
    if (!faixas(dados.hoje)[estado.pk]) estado.pk = '7d';
    const drawer = h('div', { class: 'drawer', hidden: true });
    document.body.append(drawer);
    let desenharGraficos = null;

    // Copia para a área de transferência; se o navegador bloquear (ex.: dentro do GHL), mostra o texto selecionado
    async function copiaTexto(texto, aviso, ok) {
      try {
        await navigator.clipboard.writeText(texto);
        aviso.replaceChildren(h('span', { class: 'ok' }, ok));
        setTimeout(() => { if (aviso.textContent === ok) aviso.replaceChildren(); }, 2500);
      } catch (e) {
        const campo = texto.includes('\n')
          ? h('textarea', { class: 'manual', readonly: true, rows: String(Math.min(12, texto.split('\n').length + 1)), 'aria-label': 'Links dos clientes' })
          : h('input', { class: 'manual', type: 'text', readonly: true, 'aria-label': 'Link do cliente' });
        campo.value = texto;
        aviso.replaceChildren(h('span', { class: 'hint' }, 'Copie com Ctrl+C:'), campo);
        campo.focus();
        campo.select();
      }
    }

    function render() {
      const d = estado.dados;
      const pk = estado.pk;
      const f = faixas(d.hoje)[pk];
      const clis = d.clientes;
      const t = totais(clis, pk, d.hoje);
      const comGhl = clis.filter((c) => c.ghl.conectado).length;
      // Sem nenhum cliente com GHL configurado, o painel fica só com a Meta (sem colunas e etapas do CRM)
      const usaGhl = clis.some((c) => c.ghl.conectado || (c.ghl.motivo && c.ghl.motivo !== 'não configurado'));
      estado.soMeta = !usaGhl;
      const falhasMeta = clis.reduce((a, c) => a + c.contas.filter((x) => x.erro).length, 0);
      const modelos = clis.map((cli) => ({ cli, m: calcula(cli, pk, d.hoje) }));
      const alertas = modelos.flatMap(({ cli, m }) => alertasDe(cli, m, pk)).sort((a, b) => ({ crit: 0, warn: 1, info: 2 })[a.sev] - ({ crit: 0, warn: 1, info: 2 })[b.sev]);
      const porCliente = new Map();
      for (const a of alertas) porCliente.set(a.slug, (porCliente.get(a.slug) || []).concat(a));
      const temp = (v, v0, dir) => deltaEl(delta(v, t.temPrev ? v0 : null, dir));
      const semGhl = comGhl === 0;

      const header = h('header', { class: 'top' },
        h('div', null, h('p', { class: 'eyebrow' }, 'Visão do gestor · ' + (d.agencia || '')), h('h1', null, 'Painel de Resultados')),
        h('div', { class: 'sources' },
          h('span', { class: 'src ' + (falhasMeta ? 'wait' : 'ok') }, h('span', { class: 'dot' }), 'Meta Ads ', h('b', null, falhasMeta ? falhasMeta + (falhasMeta === 1 ? ' conta com falha' : ' contas com falha') : 'ok')),
          usaGhl ? h('span', { class: 'src ' + (comGhl ? 'ok' : 'wait') }, h('span', { class: 'dot' }), 'GHL ', h('b', null, comGhl + ' de ' + clis.length + ' clientes')) : null,
          d.repo ? h('button', { class: 'btn small dark', type: 'button', onclick: () => abreGerenciar() }, 'Gerenciar clientes',
            contasLivres(d, null).length ? h('span', { class: 'badge' }, String(contasLivres(d, null).length)) : null) : null,
          // Sem âncora (#): o # do endereço guarda a chave do link
          h('button', { class: 'btn small', type: 'button', onclick: () => {
            if (estado.filtro === 'inativos') { estado.filtro = 'ativos'; gravaPref('filtro', 'ativos'); render(); }
            const alvo = document.getElementById('links');
            if (alvo) alvo.scrollIntoView({ behavior: 'smooth', block: 'start' });
          } }, 'Painéis dos clientes')));

      const controles = h('section', { class: 'controls', 'aria-label': 'Período' },
        seletorPeriodo(estado, PERIODOS.map((p) => p.k), d.hoje, (k) => { estado.pk = k; gravaPref('periodo', k); estado.todos = false; render(); }),
        faixaEl(f),
        (() => {
          const fr = textoFresh(d.geradoEm);
          return h('div', { class: 'fresh' + (fr.atrasada ? ' atrasada' : '') }, h('span', null, fr.texto),
            d.atualizarUrl ? h('a', { class: 'btn small', href: d.atualizarUrl, target: '_blank', rel: 'noopener' }, 'Atualizar agora no GitHub') : null);
        })());

      const kpis = h('section', { class: 'kpis', 'aria-label': 'Placar da agência' }, usaGhl ? null : [
        tile('Investimento', moeda(t.inv, 0), [temp(t.inv, t.inv0, 0), t.temPrev ? 'vs período anterior' : 'hoje até agora']),
        tile('Contatos no Meta', inteiro(t.cont), [temp(t.cont, t.cont0, 1), 'leads e conversas iniciadas']),
        tile('Custo por contato', moeda(div(t.cs, t.cr), 2), [temp(div(t.cs, t.cr), div(t.cs0, t.cr0), -1), 'nas campanhas que geram contato']),
        tile('Clientes investindo', inteiro(t.n), [t.temPrev ? t.n0 + ' no período anterior' : '', t.outra ? t.outra + ' em outra moeda fora da soma' : ''])
      ], !usaGhl ? null : [
        tile('Investimento', moeda(t.inv, 0), [temp(t.inv, t.inv0, 0), t.temPrev ? 'vs período anterior' : 'hoje até agora']),
        tile('Contatos no Meta', inteiro(t.cont), [temp(t.cont, t.cont0, 1), 'custo por contato ' + moeda(div(t.cs, t.cr), 2)]),
        tile('Oportunidades no CRM', semGhl ? '–' : inteiro(t.opp), semGhl ? 'GHL ainda não ligado' : [temp(t.opp, t.opp0, 1), pct(div(t.opp, t.contG)) + ' dos contatos'], semGhl),
        tile('Agendamentos', semGhl || t.ag == null ? '–' : inteiro(t.ag), semGhl || t.ag == null ? 'defina a etapa no GHL' : [temp(t.ag, t.ag0, 1), 'custo ' + moeda(div(t.invG, t.ag), 2)], semGhl || t.ag == null),
        tile('Comparecimentos', semGhl || t.cp == null ? '–' : inteiro(t.cp), semGhl || t.cp == null ? 'defina a etapa no GHL' : [temp(t.cp, t.cp0, 1), pct(div(t.cp, t.ag)) + ' dos agendados'], semGhl || t.cp == null),
        tile('Vendas', semGhl ? '–' : inteiro(t.vd), semGhl ? 'GHL ainda não ligado' : [temp(t.vd, t.vd0, 1), 'CAC ' + moeda(div(t.invG, t.vd), 2)], semGhl),
        tile('Receita gerada', semGhl ? '–' : moeda(t.rc, 0), semGhl ? 'GHL ainda não ligado' : [temp(t.rc, t.rc0, 1), 'retorno ' + vezes(div(t.rc, t.invG))], semGhl),
        tile('Clientes investindo', inteiro(t.n), [t.temPrev ? t.n0 + ' no período anterior' : '', comGhl + ' com GHL ligado', t.outra ? t.outra + ' em outra moeda fora da soma' : ''])
      ]);

      const funil = !usaGhl ? null : h('section', { class: 'funil', 'aria-labelledby': 'tFunil' },
        h('div', { class: 'hd' }, h('h2', { id: 'tFunil' }, 'Funil comercial'), h('span', { class: 'hint' }, semGhl ? 'Ligue o GHL dos clientes para completar o funil' : 'Nos ' + comGhl + ' clientes com GHL ligado · leads que entraram no período e até onde chegaram')),
        h('div', { class: 'etapas' },
          etapa(moeda(t.invG || (semGhl ? t.inv : 0), 0), 'Investimento', null, 'meta'),
          etapa(inteiro(semGhl ? t.cont : t.contG), 'Contatos no Meta', semGhl ? null : 'custo ' + moeda(div(t.invG, t.contG), 2), 'meta'),
          etapa(semGhl ? '–' : inteiro(t.opp), 'Oportunidades', semGhl ? null : pct(div(t.opp, t.contG)) + ' dos contatos', semGhl ? 'off' : ''),
          etapa(semGhl || t.ag == null ? '–' : inteiro(t.ag), 'Agendamentos', semGhl || t.ag == null ? null : pct(div(t.ag, t.opp)) + ' das oportunidades', semGhl || t.ag == null ? 'off' : ''),
          etapa(semGhl || t.cp == null ? '–' : inteiro(t.cp), 'Comparecimentos', semGhl || t.cp == null ? null : pct(div(t.cp, t.ag)) + ' dos agendados', semGhl || t.cp == null ? 'off' : ''),
          etapa(semGhl ? '–' : inteiro(t.vd), 'Vendas', semGhl ? null : moeda(t.rc, 0) + ' em receita', semGhl ? 'off' : '')));

      const visiveis = estado.todos ? alertas : alertas.slice(0, 8);
      const listaAlertas = h('ul', { class: 'alerts' }, alertas.length ? visiveis.map((a) => h('li', null, selo(a.sev),
        h('span', { class: 'txt' }, h('span', { class: 'who' }, a.quem), ' ', h('span', { class: 'what' }, a.oque), a.det ? h('span', { class: 'det' }, a.det) : null),
        h('button', { class: 'btn small', type: 'button', onclick: (ev) => { estado.foco = ev.currentTarget; abre(a.slug); } }, 'Ver cliente')))
        : h('li', null, selo('ok'), h('span', { class: 'txt' }, 'Nenhum problema encontrado neste período.'), h('span')));
      const crit = alertas.filter((a) => a.sev === 'crit').length;
      const secAlertas = h('section', { class: 'sec', 'aria-labelledby': 'tAlertas' },
        h('div', { class: 'sechead' }, h('h2', { id: 'tAlertas' }, 'Precisa de atenção'), h('span', { class: 'hint' }, alertas.length ? plural(crit, 'crítico', 'críticos') + ' · ' + inteiro(alertas.length - crit) + ' de atenção' : '')),
        listaAlertas,
        alertas.length > 8 ? h('button', { class: 'btn small', type: 'button', style: 'margin-top:8px', onclick: () => { estado.todos = !estado.todos; render(); } }, estado.todos ? 'Mostrar só os principais' : 'Ver todos os ' + alertas.length + ' alertas') : null);

      const ativos = modelos.filter(({ m }) => m && (m.cur.inv > 0 || (m.prev && m.prev.inv > 0) || (m.cur.opp || 0) > 0)).sort((a, b) => b.m.cur.inv - a.m.cur.inv);
      const parados = modelos.filter((x) => !ativos.includes(x));
      const linhas = ativos.map(({ cli, m }) => {
        const c = m.cur, p = m.prev;
        const al = porCliente.get(cli.slug) || [];
        const meta = h('div', { class: 'meta' },
          m.tipo ? h('span', { class: 'chip type' }, m.tipo.muitos) : null,
          !usaGhl || cli.ghl.conectado ? null : h('span', { class: 'chip' }, 'sem GHL'),
          cli.link ? h('a', { class: 'chip abrir', href: cli.link, target: '_blank', rel: 'noopener', title: 'Abre o painel que o cliente vê' }, 'abrir painel') : null,
          al.length ? h('span', { class: 'chip ' + (al.some((x) => x.sev === 'crit') ? 'crit' : 'warn') }, al.length === 1 ? '1 alerta' : al.length + ' alertas') : null);
        const tr = h('tr', { 'data-slug': cli.slug, 'data-nome': cli.cliente.nome },
          h('td', { class: 'l cli' }, h('button', { class: 'namebtn', type: 'button', onclick: (ev) => { estado.foco = ev.currentTarget; abre(cli.slug); } }, cli.cliente.nome), meta),
          celula(moeda(c.inv), deltaEl(delta(c.inv, p ? p.inv : null, 0))),
          m.tipo && m.curT ? celula(inteiro(m.curT.res), deltaEl(delta(m.curT.res, m.prevT ? m.prevT.res : null, 1)), rotuloRes(m.tipo, m.curT.res)) : h('td', { class: 'muted' }, pk === 'hoje' ? 'só nos períodos fechados' : '–'),
          m.tipo && m.curT ? celula(m.curT.custo != null ? moeda(m.curT.custo, 2) : '–', deltaEl(delta(m.curT.custo, m.prevT ? m.prevT.custo : null, -1)), 'por ' + m.tipo.um) : h('td', { class: 'muted' }, '–'),
          celula(inteiro(c.contatos), deltaEl(delta(c.contatos, p ? p.contatos : null, 1))),
          ...(!usaGhl ? [
            celula(c.impr ? pct(div(c.cliques, c.impr)) : '–', deltaEl(delta(div(c.cliques, c.impr), p ? div(p.cliques, p.impr) : null, 1)), 'cliques no link'),
            celula(c.impr ? moeda(div(c.inv * 1000, c.impr), 2) : '–', deltaEl(delta(div(c.inv * 1000, c.impr), p ? div(p.inv * 1000, p.impr) : null, -1)), 'por mil exibições'),
            m.freq && m.freq[0] ? celula(nf2.format(m.freq[0]), deltaEl(delta(m.freq[0], m.freq[1], 0)), 'vezes por pessoa') : h('td', { class: 'muted' }, pk === 'hoje' ? 'só nos períodos fechados' : '–')
          ] : cli.ghl.conectado ? [
            celula(inteiro(c.opp), deltaEl(delta(c.opp, p ? p.opp : null, 1)), c.contatos ? pct(div(c.opp, c.contatos)) + ' dos contatos' : null, 'ghl'),
            celula(c.ag == null ? '–' : inteiro(c.ag), deltaEl(delta(c.ag, p ? p.ag : null, 1)), c.ag != null && c.opp ? pct(div(c.ag, c.opp)) : null, 'ghl'),
            celula(c.cp == null ? '–' : inteiro(c.cp), deltaEl(delta(c.cp, p ? p.cp : null, 1)), c.cp != null && c.ag ? pct(div(c.cp, c.ag)) : null, 'ghl'),
            celula(inteiro(c.vd), deltaEl(delta(c.vd, p ? p.vd : null, 1)), null, 'ghl'),
            celula(moeda(c.rc), deltaEl(delta(c.rc, p ? p.rc : null, 1)), null, 'ghl'),
            celula(moeda(div(c.inv, c.vd), 2), deltaEl(delta(div(c.inv, c.vd), p ? div(p.inv, p.vd) : null, -1)), null, 'ghl'),
            celula(vezes(div(c.rc, c.inv)), deltaEl(delta(div(c.rc, c.inv), p ? div(p.rc, p.inv) : null, 1)), null, 'ghl')
          ] : [h('td', { class: 'ghl l muted', colspan: '7' }, cli.ghl.motivo === 'não configurado' ? 'GHL ainda não ligado para este cliente' : 'GHL: ' + (cli.ghl.motivo || 'sem dados'))]));
        tr.addEventListener('click', (ev) => { if (ev.target.closest('button,a')) return; estado.foco = tr.querySelector('.namebtn'); abre(cli.slug); });
        return tr;
      });
      const cabecalho = usaGhl
        ? [h('tr', null, h('th', { class: 'l cli', rowspan: '2', scope: 'col' }, 'Cliente'), h('th', { class: 'grp', colspan: '4', scope: 'colgroup' }, 'Meta Ads'), h('th', { class: 'grp ghl ghlcol', colspan: '7', scope: 'colgroup' }, 'GHL · funil comercial')),
          h('tr', null, ['Investimento', 'Resultado principal', 'Custo por resultado', 'Contatos'].map((x) => h('th', { scope: 'col' }, x)),
            ['Oportunidades', 'Agendamentos', 'Comparecimentos', 'Vendas', 'Receita', 'CAC', 'Retorno'].map((x) => h('th', { class: 'ghlcol', scope: 'col' }, x)))]
        : h('tr', null, h('th', { class: 'l cli', scope: 'col' }, 'Cliente'), ['Investimento', 'Resultado principal', 'Custo por resultado', 'Contatos', 'CTR', 'CPM', 'Frequência'].map((x) => h('th', { scope: 'col' }, x)));
      const tabela = h('div', { class: 'tablewrap', 'data-grupo': '' }, h('table', null,
        h('thead', null, cabecalho),
        h('tbody', null, linhas.length ? linhas : h('tr', null, h('td', { class: 'l empty-state', colspan: usaGhl ? '12' : '8' }, h('b', null, 'Nenhum cliente investiu neste período.'), 'Escolha um período maior.')))));

      // Filtro: ativos (na base), inativos (pausados com "ativo": false) ou todos, mais busca por nome
      const listaInativos = (d.inativos || []).slice().sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
      const nInat = listaInativos.length;
      const verAtivos = estado.filtro !== 'inativos';
      const verInativos = estado.filtro !== 'ativos';
      const barraFiltro = h('div', { class: 'filtros' },
        h('div', { class: 'seg', role: 'group', 'aria-label': 'Filtrar clientes' },
          [['ativos', 'Ativos', clis.length], ['inativos', 'Inativos', nInat], ['todos', 'Todos', clis.length + nInat]].map(([k, t, n]) => h('button', {
            type: 'button', 'aria-pressed': String(estado.filtro === k),
            onclick: () => { estado.filtro = k; gravaPref('filtro', k); render(); }
          }, t, ' ', h('span', { class: 'n' }, inteiro(n))))),
        h('input', { class: 'busca', type: 'search', placeholder: 'Buscar cliente', 'aria-label': 'Buscar cliente', value: estado.busca, oninput: (ev) => { estado.busca = ev.target.value; aplicaBusca(); } }));
      const blocoInativos = verInativos ? h('div', { class: 'inativos', 'data-grupo': '' },
        h('h3', null, 'Inativos ', h('span', { class: 'hint' }, 'pausados: sem coleta e com o link do cliente desligado')),
        nInat ? h('ul', { class: 'acclist' }, listaInativos.map((c) => h('li', { 'data-nome': c.nome },
          h('span', { class: 'nome' }, c.nome, ' ', h('span', { class: 'chip' }, 'pausado')),
          h('small', null, [c.segmento, plural(c.contas, 'conta Meta', 'contas Meta')].filter(Boolean).join(' · ')))))
          : h('p', { class: 'hint' }, 'Nenhum cliente pausado.'),
        d.repo ? h('p', { class: 'hint' }, 'Para pausar, reativar, adicionar ou remover clientes, use ', h('button', { class: 'linkbtn', type: 'button', onclick: () => abreGerenciar() }, 'Gerenciar clientes'), '.') : null) : null;
      const dica = estado.filtro === 'inativos' ? plural(nInat, 'cliente pausado', 'clientes pausados')
        : estado.filtro === 'todos' ? ativos.length + ' com movimento no período · ' + plural(nInat, 'pausado', 'pausados')
          : ativos.length + ' com movimento no período';

      const secClientes = h('section', { class: 'sec clientes' + (usaGhl ? '' : ' so-meta'), 'aria-labelledby': 'tClientes' },
        h('div', { class: 'sechead' }, h('h2', { id: 'tClientes' }, 'Clientes'), h('span', { class: 'hint' }, dica)),
        barraFiltro,
        verAtivos ? tabela : null,
        verAtivos && parados.length ? h('details', { class: 'list', 'data-grupo': '' }, h('summary', null, h('b', null, parados.length === 1 ? '1 cliente' : parados.length + ' clientes'), ' sem investimento neste período e no anterior'),
          h('ul', { class: 'acclist' }, parados.map(({ cli }) => h('li', { 'data-nome': cli.cliente.nome }, h('button', { class: 'namebtn', type: 'button', onclick: (ev) => { estado.foco = ev.currentTarget; abre(cli.slug); } }, cli.cliente.nome), h('small', null, cli.contas.length + (cli.contas.length === 1 ? ' conta Meta' : ' contas Meta')))))) : null,
        blocoInativos,
        h('p', { class: 'hint sem-resultado', hidden: true }, 'Nenhum cliente com esse nome.'));

      const rodape = h('footer', { class: 'foot' },
        usaGhl ? [
          h('p', null, h('b', null, 'Contatos'), ' somam leads e conversas iniciadas registrados pela Meta. ', h('b', null, 'Funil comercial'), ' acompanha os leads que entraram no CRM no período: quantos agendaram, compareceram e compraram até agora. CAC é o investimento dividido pelas vendas; retorno é a receita dividida pelo investimento.'),
          h('p', null, h('b', null, 'Alertas'), ' aparecem quando a conta tem problema na Meta ou está perto do limite de gastos, uma campanha está travada, o investimento parou, o cliente gastou mais do que um resultado custava antes sem gerar nenhum, o custo por resultado subiu mais de 30% com pelo menos 3 resultados nos dois períodos, ou menos da metade dos contatos do Meta virou oportunidade no CRM.')
        ] : [
          h('p', null, h('b', null, 'Contatos'), ' somam leads e conversas iniciadas registrados pela Meta. ', h('b', null, 'Custo por contato'), ' considera só as campanhas que geram contato (mensagens e formulários). ', h('b', null, 'CTR'), ' é a parte das exibições que virou clique no link, ', h('b', null, 'CPM'), ' é o custo de mil exibições e ', h('b', null, 'frequência'), ' é quantas vezes, em média, cada pessoa viu os anúncios.'),
          h('p', null, h('b', null, 'Alertas'), ' aparecem quando a conta tem problema na Meta ou está perto do limite de gastos, uma campanha está travada, o investimento parou, o cliente gastou mais do que um resultado custava antes sem gerar nenhum, ou o custo por resultado subiu mais de 30% com pelo menos 3 resultados nos dois períodos.')
        ],
        h('p', null, 'Os períodos usam dias completos e terminam ontem. A opção Hoje mostra o dia em andamento, sem comparação.'));

      // Painéis dos clientes: abrir e copiar o link de cada um (para mandar ao cliente ou pôr no menu do GHL)
      const comLink = modelos.filter(({ cli }) => cli.link).sort((a, b) => a.cli.cliente.nome.localeCompare(b.cli.cliente.nome, 'pt-BR'));
      const avisoTodos = h('span', { class: 'copiado', 'aria-live': 'polite' });
      const secLinks = comLink.length && verAtivos ? h('section', { class: 'sec links', id: 'links', 'aria-labelledby': 'tLinks' },
        h('div', { class: 'sechead' }, h('h2', { id: 'tLinks' }, 'Painéis dos clientes'),
          h('div', { class: 'acoes' }, h('span', { class: 'hint' }, 'para mandar ao cliente ou colocar no menu do GHL'),
            h('button', { class: 'btn small', type: 'button', onclick: () => copiaTexto(comLink.map(({ cli }) => cli.cliente.nome + ': ' + cli.link).join('\n'), avisoTodos, 'Links copiados') }, 'Copiar todos os links'))),
        avisoTodos,
        h('ul', { class: 'cartoes', 'data-grupo': '' }, comLink.map(({ cli, m }) => {
          const aviso = h('span', { class: 'copiado', 'aria-live': 'polite' });
          const semAcesso = cli.contas.filter((x) => x.erro).length;
          const resumo = [
            m && m.cur.inv > 0 ? moeda(m.cur.inv) + ' no período' + (m.tipo && m.curT ? ' · ' + inteiro(m.curT.res) + ' ' + rotuloRes(m.tipo, m.curT.res) : '') : 'sem investimento no período',
            semAcesso ? (semAcesso === 1 ? '1 conta sem acesso' : semAcesso + ' contas sem acesso') : null
          ].filter(Boolean).join(' · ');
          return h('li', { class: 'cartao', 'data-nome': cli.cliente.nome },
            h('div', null, h('b', null, cli.cliente.nome), h('span', { class: 'hint' + (semAcesso ? ' alerta' : '') }, resumo)),
            h('div', { class: 'acoes' },
              h('a', { class: 'btn small dark', href: cli.link, target: '_blank', rel: 'noopener' }, 'Abrir painel'),
              h('button', { class: 'btn small', type: 'button', onclick: () => copiaTexto(cli.link, aviso, 'Link copiado') }, 'Copiar link'),
              h('button', { class: 'btn small', type: 'button', onclick: (ev) => { estado.foco = ev.currentTarget; abre(cli.slug); } }, 'Detalhes')),
            aviso);
        }))) : null;

      app.replaceChildren(...[header, avisoEl(d), controles, kpis, funil, secAlertas, secClientes, secLinks, rodape].filter(Boolean));
      aplicaBusca();
      if (estado.aberto && estado.aberto !== GER) renderPainel();
    }

    // ----- Painel do cliente (gestor) -----
    function abre(slug) {
      estado.aberto = slug;
      drawer.hidden = false;
      document.body.style.overflow = 'hidden';
      renderPainel();
      const fechar = drawer.querySelector('[data-fechar]');
      if (fechar) fechar.focus();
    }
    function fecha() {
      const slug = estado.aberto;
      estado.aberto = null;
      drawer.hidden = true;
      drawer.replaceChildren();
      document.body.style.overflow = '';
      escondeTip();
      const alvo = estado.foco && document.contains(estado.foco) ? estado.foco
        : (slug && slug !== GER ? document.querySelector('tr[data-slug="' + CSS.escape(slug) + '"] .namebtn') : null);
      if (alvo) alvo.focus();
    }
    document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && !drawer.hidden) fecha(); });

    function renderPainel() {
      const d = estado.dados;
      const cli = d.clientes.find((c) => c.slug === estado.aberto);
      if (!cli) { fecha(); return; }
      const pk = estado.pk;
      const m = calcula(cli, pk, d.hoje);
      const f = m.f;
      const c = m.cur, p = m.prev;
      const dl = (v, v0, dir) => deltaEl(delta(v, p ? v0 : null, dir));
      const al = alertasDe(cli, m, pk);
      const copiaMsg = h('span', { class: 'copy-ok', 'aria-live': 'polite' });
      const botoesLink = cli.link ? [
        h('button', { class: 'btn small', type: 'button', onclick: async () => {
          try { await navigator.clipboard.writeText(cli.link); copiaMsg.textContent = 'Link copiado'; }
          catch (e) { const inp = h('input', { type: 'text', value: cli.link, readonly: true, 'aria-label': 'Link do cliente', style: 'width:100%' }); copiaMsg.replaceChildren(inp); inp.select(); }
        } }, 'Copiar link do cliente'),
        h('a', { class: 'btn small', href: cli.link, target: '_blank', rel: 'noopener' }, 'Abrir visão do cliente'),
        copiaMsg] : [h('span', { class: 'muted' }, 'Sem link de cliente (interno)')];

      const minisMeta = h('div', { class: 'minis' },
        mini('Investimento', moeda(c.inv), [dl(c.inv, p && p.inv, 0), p ? 'antes ' + moeda(p.inv) : '']),
        m.tipo && m.curT ? mini('Resultado principal', inteiro(m.curT.res) + ' ' + rotuloRes(m.tipo, m.curT.res), [dl(m.curT.res, m.prevT && m.prevT.res, 1), m.curT.custo != null ? moeda(m.curT.custo, 2) + ' por ' + m.tipo.um : 'sem resultado']) : mini('Resultado principal', '–', pk === 'hoje' ? 'só nos períodos fechados' : 'sem campanhas com resultado', true),
        mini('Contatos', inteiro(c.contatos), [dl(c.contatos, p && p.contatos, 1), plural(c.leads, 'lead', 'leads') + ' · ' + plural(c.conversas, 'conversa', 'conversas')]),
        c.conversas > 0 ? mini('Conversas engajadas', inteiro(c.conv3), [pct(div(c.conv3, c.conversas)) + ' das conversas', 'a pessoa mandou 3 ou mais mensagens']) : mini('Visitas na página', inteiro(c.lpv), [dl(c.lpv, p && p.lpv, 1), c.cliques ? pct(div(c.lpv, c.cliques)) + ' dos cliques' : '']),
        mini('Cliques no link', inteiro(c.cliques), [dl(c.cliques, p && p.cliques, 1), 'CTR ' + pct(div(c.cliques, c.impr))]),
        mini('CPM', moeda(div(c.inv * 1000, c.impr), 2), [dl(div(c.inv * 1000, c.impr), p && div(p.inv * 1000, p.impr), -1), 'custo por mil impressões']),
        mini('Alcance', m.alcance ? inteiro(m.alcance[0]) : '–', m.alcance ? [dl(m.alcance[0], m.alcance[1], 1), cli.contas.length > 1 ? 'soma das contas' : 'contas alcançadas'] : (pk === 'hoje' ? 'só nos períodos fechados' : 'não informado pela Meta'), !m.alcance),
        mini('Frequência', m.freq && m.freq[0] ? nf2.format(m.freq[0]) : '–', m.freq ? [dl(m.freq[0], m.freq[1], 0), 'vezes que cada conta viu o anúncio'] : '', !m.freq));

      const soMeta = !!estado.soMeta;
      const tk = cli.cliente.ticketMedio;
      const vendasPagam = tk && c.inv > 0 ? Math.ceil(c.inv / tk) : null;
      const notaTicket = soMeta && vendasPagam ? h('p', { class: 'hint', style: 'margin:10px 0 0' }, 'Com ticket médio de ' + moeda(tk, 2) + ', o investimento do período se paga com ' + vendasPagam + (vendasPagam === 1 ? ' venda.' : ' vendas.')) : null;
      let blocoGhl = null;
      if (soMeta) {
        blocoGhl = null;
      } else if (cli.ghl.conectado) {
        blocoGhl = h('div', { class: 'minis' },
          mini('Oportunidades no CRM', inteiro(c.opp), [dl(c.opp, p && p.opp, 1), pct(div(c.opp, c.contatos)) + ' dos contatos', 'custo ' + moeda(div(c.inv, c.opp), 2)]),
          mini('Agendamentos', c.ag == null ? '–' : inteiro(c.ag), c.ag == null ? 'defina a etapa de agendamento' : [dl(c.ag, p && p.ag, 1), pct(div(c.ag, c.opp)) + ' das oportunidades', 'custo ' + moeda(div(c.inv, c.ag), 2)], c.ag == null),
          mini('Comparecimentos', c.cp == null ? '–' : inteiro(c.cp), c.cp == null ? 'defina a etapa de comparecimento' : [dl(c.cp, p && p.cp, 1), pct(div(c.cp, c.ag)) + ' dos agendados', 'custo ' + moeda(div(c.inv, c.cp), 2)], c.cp == null),
          mini('Vendas', inteiro(c.vd), [dl(c.vd, p && p.vd, 1), 'CAC ' + moeda(div(c.inv, c.vd), 2)]),
          mini('Receita gerada', moeda(c.rc), [dl(c.rc, p && p.rc, 1), 'retorno ' + vezes(div(c.rc, c.inv))]),
          mini('Ticket médio', moeda(div(c.rc, c.vd) || cli.cliente.ticketMedio, 2), div(c.rc, c.vd) ? 'das vendas do período' : (cli.cliente.ticketMedio ? 'informado na configuração' : 'sem vendas no período'), !div(c.rc, c.vd) && !cli.cliente.ticketMedio),
          mini('Vendas fechadas no período', inteiro(c.vdF), [moeda(c.rcF), 'inclui leads de antes do período']),
          mini('CAC por ticket', div(c.inv, c.vd) && div(c.rc, c.vd) ? nf1.format(div(c.inv, c.vd) / div(c.rc, c.vd) * 100) + '%' : '–', 'quanto da venda vai para a mídia', !(div(c.inv, c.vd) && div(c.rc, c.vd))));
      } else {
        blocoGhl = h('div', { class: 'callout' }, cli.ghl.motivo === 'não configurado'
          ? 'O GHL deste cliente ainda não foi ligado. Preencha a subconta, o pipeline e as etapas em config/clientes.json e cadastre o token da subconta no GitHub.'
          : 'GHL sem dados: ' + (cli.ghl.motivo || 'motivo desconhecido'),
          vendasPagam ? ' Com ticket médio de ' + moeda(tk, 2) + ', o investimento do período se paga com ' + vendasPagam + (vendasPagam === 1 ? ' venda.' : ' vendas.') : '');
      }

      const graf = blocoGraficos(cli, f, d.hoje, cli.ghl.conectado);
      const diag = h('div', { class: 'diag' },
        h('dl', null,
          cli.contas.map((x) => [h('dt', null, 'Conta Meta ' + x.id), h('dd', null, x.nome + (x.erro ? ' · falha: ' + x.erro : x.status && x.status !== 'ACTIVE' ? ' · ' + (STATUS_CONTA[x.status] || x.status) : ' · ativa') + (x.avisos && x.avisos.length ? ' · ' + x.avisos.join(' ') : ''))]),
          soMeta ? null : [h('dt', null, 'GHL'), h('dd', null, cli.ghl.conectado ? 'Pipeline ' + cli.ghl.pipeline + ' · agendamento: ' + (cli.ghl.etapaAgendado || 'não definido') + ' · comparecimento: ' + (cli.ghl.etapaCompareceu || 'não definido') : (cli.ghl.motivo || 'não configurado'))],
          cli.ghl.conectado ? [h('dt', null, 'Filtro de origem'), h('dd', null, cli.ghl.filtroOrigem && cli.ghl.filtroOrigem.length ? cli.ghl.filtroOrigem.join(', ') : 'nenhum (conta todas as oportunidades do pipeline)')] : null,
          cli.ghl.origens && Object.keys(cli.ghl.origens).length ? [h('dt', null, 'Origens nos últimos 30 dias'), h('dd', null, Object.entries(cli.ghl.origens).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ' (' + v + ')').join(', '))] : null,
          cli.ghl.pipelines && cli.ghl.pipelines.length ? [h('dt', null, 'Pipelines na subconta'), h('dd', null, cli.ghl.pipelines.map((x) => x.nome + ': ' + x.etapas.join(' › ')).join(' · '))] : null));

      drawer.replaceChildren(
        h('div', { class: 'scrim', onclick: fecha }),
        h('div', { class: 'panel', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'dNome' },
          h('div', { class: 'dhead' },
            h('div', null, h('h2', { id: 'dNome' }, cli.cliente.nome), h('div', { class: 'sub' }, botoesLink)),
            h('button', { class: 'btn', type: 'button', 'data-fechar': '', onclick: fecha }, 'Fechar')),
          al.length ? h('div', { class: 'dsec' }, h('ul', { class: 'alerts' }, al.map((x) => h('li', null, selo(x.sev), h('span', { class: 'txt' }, h('span', { class: 'what' }, x.oque), x.det ? h('span', { class: 'det' }, x.det) : null), h('span'))))) : null,
          h('div', { class: 'dsec' }, h('div', { class: 'row' }, h('h3', null, 'Meta Ads · ' + (pk === 'hoje' ? 'hoje até agora' : faixaTxt(f.cur.s, f.cur.e))), h('span', { class: 'hint' }, p ? 'Setas comparam com ' + faixaTxt(f.prev.s, f.prev.e) : '')), minisMeta, notaTicket),
          soMeta ? null : h('div', { class: 'dsec' }, h('div', { class: 'row' }, h('h3', null, 'Funil comercial (GHL)'), h('span', { class: 'hint' }, cli.ghl.conectado ? 'leads que entraram no período e até onde chegaram' : '')), blocoGhl),
          graf.bloco,
          pk === 'hoje' ? null : h('div', { class: 'dsec camps' }, h('div', { class: 'row' }, h('h3', null, 'Campanhas'), h('span', { class: 'hint' }, 'com investimento ou problema no período')), tabelaCampanhas(m, { comConta: cli.contas.length > 1, orcamento: true })),
          h('div', { class: 'dsec' }, h('div', { class: 'row' }, h('h3', null, 'Diagnóstico da integração'), h('span', { class: 'hint' }, 'só o gestor vê')), diag)));
      desenharGraficos = graf.desenhar;
      requestAnimationFrame(() => { if (desenharGraficos) desenharGraficos(); });
    }

    // ----- Gerenciar clientes: adicionar, pausar, reativar e remover pelo painel -----
    // Salva config/clientes.json no GitHub com um token deste navegador; o salvamento dispara a atualização.
    const cofre = criaCofre(cred);
    const ger = { gh: null, cfg: null, sha: null, carregando: false, salvando: false, msg: null, form: null, remover: null, esperando: false };
    const urlToken = (dono) => 'https://github.com/settings/personal-access-tokens/new?name=painel-edicao&description=' +
      encodeURIComponent('Editar a lista de clientes do painel de resultados') + '&target_name=' + encodeURIComponent(dono) + '&expires_in=none&contents=write';

    function contasLivres(d, cfg) {
      const usadas = new Set();
      if (cfg) {
        for (const c of cfg.clientes || []) for (const id of ((c.meta && c.meta.contas) || [])) usadas.add(String(id).replace(/^act_/, ''));
      } else {
        for (const c of d.clientes) for (const x of c.contas) usadas.add(String(x.id));
        for (const c of d.inativos || []) for (const id of c.contasIds || []) usadas.add(String(id));
      }
      return (d.contasDisponiveis || []).filter((x) => !usadas.has(x.id));
    }

    async function abreGerenciar() {
      estado.aberto = GER;
      drawer.hidden = false;
      document.body.style.overflow = 'hidden';
      ger.msg = null; ger.form = null; ger.remover = null;
      renderGerenciar();
      const fechar = drawer.querySelector('[data-fechar]');
      if (fechar) fechar.focus();
      if (!ger.gh && estado.dados.repo) {
        // 1º: token que vem no próprio link do gestor (segredo PAINEL_EDICAO); 2º: token colado neste navegador
        const token = estado.dados.edicaoToken || await cofre.le();
        if (token) { ger.gh = criaGithub(estado.dados.repo, token); ger.doLink = !!estado.dados.edicaoToken; }
      }
      if (ger.gh) await carregaCfg();
    }

    async function carregaCfg() {
      ger.carregando = true;
      if (estado.aberto === GER) renderGerenciar();
      try { const r = await ger.gh.le(); ger.cfg = r.cfg; ger.sha = r.sha; }
      catch (e) { ger.msg = { tipo: 'erro', texto: erroDoToken(e) }; if (e.tipo === 'token') { ger.gh = null; ger.doLink = false; } }
      ger.carregando = false;
      if (estado.aberto === GER) renderGerenciar();
    }

    async function conecta(token) {
      token = String(token || '').trim();
      if (!/^(github_pat_|ghp_)[A-Za-z0-9_]{20,}$/.test(token)) {
        ger.msg = { tipo: 'erro', texto: 'Isso não parece um token do GitHub. Ele começa com github_pat_.' };
        renderGerenciar();
        return;
      }
      ger.gh = criaGithub(estado.dados.repo, token);
      ger.msg = null;
      await carregaCfg();
      if (ger.cfg) {
        await cofre.grava(token);
        ger.msg = { tipo: 'ok', texto: 'Conectado. Este navegador já pode editar a lista de clientes.' };
        renderGerenciar();
      }
    }

    async function salva(operacao, mensagem, ok) {
      if (ger.salvando) return;
      ger.salvando = true;
      ger.msg = { tipo: 'info', texto: 'Salvando…' };
      renderGerenciar();
      try {
        for (let tentativa = 0; ; tentativa++) {
          const atual = await ger.gh.le();
          const novo = operacao(JSON.parse(JSON.stringify(atual.cfg)));
          try { ger.sha = await ger.gh.grava(novo, atual.sha, mensagem); ger.cfg = novo; break; }
          catch (e) { if (e.tipo !== 'conflito' || tentativa >= 1) throw e; }
        }
        ger.form = null; ger.remover = null; ger.esperando = true;
        ger.msg = { tipo: 'ok', texto: ok + ' O painel se atualiza sozinho em cerca de 2 minutos.' };
        if (acelera) acelera();
      } catch (e) {
        ger.msg = { tipo: 'erro', texto: erroDoToken(e) };
        if (e.tipo === 'token') { if (!ger.doLink) cofre.esquece(); ger.gh = null; ger.doLink = false; }
      }
      ger.salvando = false;
      if (estado.aberto === GER) renderGerenciar();
    }

    function erroDoToken(e) {
      // Token do link (segredo PAINEL_EDICAO) recusado: explica onde trocar, sem apagar nada
      if (e.tipo === 'token' && ger.doLink) return 'O token de edição salvo no GitHub (PAINEL_EDICAO) não funciona mais. Crie um novo e troque o valor desse segredo.';
      return e.message;
    }

    function gerAtualizado() {
      if (ger.esperando) { ger.esperando = false; if (!ger.form) ger.msg = { tipo: 'ok', texto: 'Painel atualizado com as mudanças.' }; }
      if (!ger.form) renderGerenciar();
    }

    function renderGerenciar() {
      const d = estado.dados;
      const repo = d.repo || '';
      const [dono, repoNome] = repo.split('/');
      const disp = new Map((d.contasDisponiveis || []).map((x) => [x.id, x]));
      const nomeConta = (id) => (disp.get(String(id)) || {}).nome || String(id);
      const msg = ger.msg ? h('div', { class: 'ger-msg ' + ger.msg.tipo, role: ger.msg.tipo === 'erro' ? 'alert' : 'status' }, ger.msg.texto) : null;
      let corpo;
      if (!repo) {
        corpo = h('div', { class: 'dsec' }, h('div', { class: 'callout' }, 'A edição pelo painel funciona quando ele é atualizado pelo GitHub.'));
      } else if (!ger.gh) {
        let campo;
        corpo = h('div', { class: 'dsec ger-conectar' },
          h('h3', null, 'Liberar a edição (uma vez só)'),
          h('p', { class: 'hint' }, 'O painel só mostra os números. A lista de clientes fica guardada no seu GitHub, e para este botão salvar lá ele precisa de uma chave de escrita: um token do GitHub que só mexe no repositório ', h('b', null, repoNome), '.'),
          h('ol', { class: 'ger-passos' },
            h('li', null, h('a', { href: urlToken(dono), target: '_blank', rel: 'noopener' }, 'Criar o token'), ' (o formulário já abre preenchido): em ', h('b', null, 'Repository access'), ', escolha ', h('b', null, 'Only select repositories'), ', marque ', h('b', null, repoNome), ' e clique em ', h('b', null, 'Generate token'), '.'),
            h('li', null, 'Copie o token e salve como ', h('a', { href: 'https://github.com/' + repo + '/settings/secrets/actions/new', target: '_blank', rel: 'noopener' }, 'novo segredo'), ' com o nome ', h('b', null, 'PAINEL_EDICAO'), '.'),
            h('li', null, 'Pronto. A partir da próxima atualização do painel, este botão funciona direto em qualquer navegador aberto com o seu link de gestor, inclusive dentro do GHL.')),
          h('p', { class: 'hint' }, 'Quem tiver o seu link de gestor também vai conseguir editar a lista de clientes.'),
          h('details', { class: 'ger-alternativa' },
            h('summary', null, 'Prefere liberar só neste navegador? Cole o token aqui'),
            h('form', { class: 'ger-form-token', onsubmit: (ev) => { ev.preventDefault(); conecta(campo.value); } },
              campo = h('input', { type: 'password', placeholder: 'github_pat_...', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Token do GitHub', required: true }),
              h('button', { class: 'btn dark', type: 'submit' }, 'Conectar'))));
      } else if (!ger.cfg) {
        corpo = h('div', { class: 'dsec' }, h('p', { class: 'hint' }, ger.carregando ? 'Carregando a lista de clientes…' : 'Não foi possível carregar a lista de clientes.'));
      } else if (ger.form) {
        corpo = formCliente(d, disp);
      } else {
        corpo = listaGerenciar(d, nomeConta);
      }
      drawer.replaceChildren(
        h('div', { class: 'scrim', onclick: fecha }),
        h('div', { class: 'panel', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'gTit' },
          h('div', { class: 'dhead' },
            h('div', null, h('h2', { id: 'gTit' }, 'Gerenciar clientes'),
              h('div', { class: 'sub' }, 'Adicione, pause, reative ou remova clientes. Depois de salvar, o painel se atualiza sozinho.')),
            h('button', { class: 'btn', type: 'button', 'data-fechar': '', onclick: fecha }, 'Fechar')),
          msg, corpo,
          ger.gh && !ger.form && ger.doLink ? h('p', { class: 'hint ger-rodape' }, 'Edição liberada pelo seu link de gestor (segredo PAINEL_EDICAO no GitHub).') : null,
          ger.gh && !ger.form && !ger.doLink ? h('p', { class: 'hint ger-rodape' }, h('button', { class: 'linkbtn', type: 'button', onclick: () => {
            cofre.esquece(); ger.gh = null; ger.cfg = null;
            ger.msg = { tipo: 'info', texto: 'Este navegador foi desconectado do GitHub.' };
            renderGerenciar();
          } }, 'Desconectar este navegador')) : null));
    }

    function listaGerenciar(d, nomeConta) {
      const clientes = (ger.cfg.clientes || []).slice().sort((a, b) => (a.ativo === false) - (b.ativo === false) || String(a.nome).localeCompare(String(b.nome), 'pt-BR'));
      const nAtivos = clientes.filter((c) => c.ativo !== false).length;
      const livres = contasLivres(d, ger.cfg);
      const bloqueado = ger.salvando;
      const editar = (c) => {
        ger.form = { novo: false, slug: c.slug, nome: c.nome, segmento: c.segmento || '', contas: ((c.meta && c.meta.contas) || []).map(String), ticket: c.ticketMedio || '', link: c.link !== false };
        ger.msg = null;
        renderGerenciar();
      };
      return h('div', null,
        h('div', { class: 'dsec' },
          h('div', { class: 'row' },
            h('h3', null, 'Clientes ', h('span', { class: 'hint' }, plural(nAtivos, 'ativo', 'ativos') + ' · ' + plural(clientes.length - nAtivos, 'pausado', 'pausados'))),
            h('button', { class: 'btn small dark', type: 'button', disabled: bloqueado, onclick: () => { ger.form = { novo: true, contas: [], link: true }; ger.msg = null; renderGerenciar(); } }, 'Adicionar cliente')),
          h('ul', { class: 'ger-lista' }, clientes.map((c) => {
            const pausado = c.ativo === false;
            const contas = ((c.meta && c.meta.contas) || []).map(nomeConta);
            return h('li', { class: 'ger-item' + (pausado ? ' pausado' : '') },
              h('div', { class: 'ger-info' },
                h('div', { class: 'ger-nome' }, h('b', null, c.nome), pausado ? h('span', { class: 'chip' }, 'pausado') : null, c.link === false ? h('span', { class: 'chip' }, 'sem link') : null),
                h('small', null, [c.segmento, contas.length ? contas.join(', ') : 'sem conta de anúncios'].filter(Boolean).join(' · '))),
              h('div', { class: 'acoes' },
                h('button', { class: 'btn small', type: 'button', disabled: bloqueado, onclick: () => salva((cfg) => {
                  const x = cfg.clientes.find((y) => y.slug === c.slug);
                  if (!x) throw new Error('Esse cliente não está mais na lista.');
                  if (pausado) delete x.ativo; else x.ativo = false;
                  return cfg;
                }, (pausado ? 'Painel: reativa ' : 'Painel: pausa ') + c.nome, c.nome + (pausado ? ' reativado.' : ' pausado.')) }, pausado ? 'Reativar' : 'Pausar'),
                h('button', { class: 'btn small', type: 'button', disabled: bloqueado, onclick: () => editar(c) }, 'Editar'),
                ger.remover === c.slug
                  ? h('button', { class: 'btn small perigo', type: 'button', disabled: bloqueado, onclick: () => salva((cfg) => { cfg.clientes = cfg.clientes.filter((y) => y.slug !== c.slug); return cfg; }, 'Painel: remove ' + c.nome, c.nome + ' removido.') }, 'Confirmar remoção')
                  : h('button', { class: 'btn small', type: 'button', disabled: bloqueado, onclick: () => {
                    ger.remover = c.slug;
                    renderGerenciar();
                    setTimeout(() => { if (ger.remover === c.slug) { ger.remover = null; if (estado.aberto === GER && !ger.form) renderGerenciar(); } }, 6000);
                  } }, 'Remover')));
          }))),
        h('div', { class: 'dsec' },
          h('div', { class: 'row' },
            h('h3', null, 'Contas de anúncios sem cliente ', livres.length ? h('span', { class: 'chip warn' }, String(livres.length)) : null),
            h('span', { class: 'hint' }, 'o painel já consegue ler, mas ainda não estão em nenhum cliente')),
          d.contasDisponiveis == null ? h('p', { class: 'hint' }, 'Esta lista aparece depois da próxima atualização do painel.')
            : livres.length ? h('ul', { class: 'ger-lista' }, livres.map((x) => h('li', { class: 'ger-item' },
              h('div', { class: 'ger-info' }, h('div', { class: 'ger-nome' }, h('b', null, x.nome || x.id)),
                h('small', null, [x.dono, 'ID ' + x.id, x.status && x.status !== 'ACTIVE' ? (STATUS_CONTA[x.status] || x.status) : null].filter(Boolean).join(' · '))),
              h('div', { class: 'acoes' }, h('button', { class: 'btn small', type: 'button', disabled: bloqueado, onclick: () => {
                ger.form = { novo: true, nome: x.nome || '', contas: [x.id], link: true };
                ger.msg = null;
                renderGerenciar();
              } }, 'Criar cliente com esta conta')))))
              : h('p', { class: 'hint' }, 'Todas as contas que o painel enxerga já estão em algum cliente.'),
          h('p', { class: 'hint' }, 'Se uma conta não aparece aqui, libere ela para o usuário do sistema do painel no Gerenciador de Negócios (permissão Ver desempenho). Ela entra nesta lista na atualização seguinte.')));
    }

    function formCliente(d, disp) {
      const f = ger.form;
      const todas = d.contasDisponiveis || [];
      const marcadas = new Set((f.contas || []).map(String));
      const emOutro = new Map();
      for (const c of ger.cfg.clientes || []) if (c.slug !== f.slug) for (const id of ((c.meta && c.meta.contas) || [])) emOutro.set(String(id), c.nome);
      const extras = [...marcadas].filter((id) => !disp.has(id));
      const segmentos = [...new Set((ger.cfg.clientes || []).map((c) => c.segmento).filter(Boolean).concat(['Estética', 'Ótica']))];
      let campoNome, campoSeg, campoOutras, campoTicket, campoLink, filtro;
      const lista = h('div', { class: 'ger-contas' }, todas.length
        ? todas.map((x) => h('label', { class: 'ger-conta', 'data-busca': [x.nome, x.dono, x.id].join(' ') },
          h('input', { type: 'checkbox', value: x.id, checked: marcadas.has(x.id) }),
          h('span', null, h('b', null, x.nome || x.id), h('small', null, [x.dono, 'ID ' + x.id, emOutro.has(x.id) ? 'já está em ' + emOutro.get(x.id) : null].filter(Boolean).join(' · ')))))
        : h('p', { class: 'hint' }, 'A lista de contas aparece depois da próxima atualização do painel. Por enquanto, informe o ID da conta logo abaixo.'));
      const erroForm = (texto) => { ger.msg = { tipo: 'erro', texto }; renderGerenciar(); };
      return h('form', { class: 'dsec ger-form', novalidate: true, onsubmit: (ev) => {
        ev.preventDefault();
        const nome = campoNome.value.trim().replace(/\s+/g, ' ');
        const segmento = campoSeg.value.trim();
        const contas = [...new Set([...lista.querySelectorAll('input[type=checkbox]:checked')].map((x) => x.value)
          .concat(campoOutras.value.split(/[\s,;]+/).map((x) => x.replace(/^act_/, '').trim()).filter(Boolean)))];
        Object.assign(ger.form, { nome, segmento, contas, ticket: campoTicket.value, link: campoLink.checked });
        const invalidas = contas.filter((id) => !/^\d{3,20}$/.test(id));
        if (!nome) return erroForm('Informe o nome do cliente.');
        if (!contas.length) return erroForm('Marque pelo menos uma conta de anúncios.');
        if (invalidas.length) return erroForm('ID de conta inválido: ' + invalidas.join(', ') + '. Use só os números da conta.');
        const ticketOk = valorEmReais(campoTicket.value);
        if (String(campoTicket.value).trim() && ticketOk == null) return erroForm('Ticket médio inválido. Use só números, como 1500 ou 1.500,00.');
        if (f.novo) {
          salva((cfg) => {
            const usados = new Set(cfg.clientes.map((c) => c.slug));
            const novo = { slug: criaSlug(nome, usados), nome };
            if (segmento) novo.segmento = segmento;
            if (!campoLink.checked) novo.link = false;
            novo.meta = { contas };
            novo.ticketMedio = ticketOk;
            cfg.clientes.push(novo);
            return cfg;
          }, 'Painel: adiciona ' + nome, nome + ' adicionado.');
        } else {
          salva((cfg) => {
            const x = cfg.clientes.find((y) => y.slug === f.slug);
            if (!x) throw new Error('Esse cliente não está mais na lista.');
            x.nome = nome;
            if (segmento) x.segmento = segmento; else delete x.segmento;
            x.meta = Object.assign({}, x.meta, { contas });
            x.ticketMedio = ticketOk;
            if (campoLink.checked) delete x.link; else x.link = false;
            return cfg;
          }, 'Painel: atualiza ' + nome, nome + ' atualizado.');
        }
      } },
        h('h3', null, f.novo ? 'Novo cliente' : 'Editar ' + f.nome),
        h('label', { class: 'ger-campo' }, 'Nome do cliente', campoNome = h('input', { type: 'text', maxlength: '80', value: f.nome || '', placeholder: 'Ex.: Dra. Ana Souza' })),
        h('label', { class: 'ger-campo' }, 'Segmento (opcional)', campoSeg = h('input', { type: 'text', maxlength: '40', value: f.segmento || '', list: 'gSegmentos', placeholder: 'Ex.: Estética' })),
        h('datalist', { id: 'gSegmentos' }, segmentos.map((s) => h('option', { value: s }))),
        h('fieldset', { class: 'ger-campo' }, h('legend', null, 'Contas de anúncios'),
          todas.length > 6 ? (filtro = h('input', { type: 'search', class: 'busca', placeholder: 'Filtrar contas', 'aria-label': 'Filtrar contas', oninput: () => {
            const q = normaliza(filtro.value);
            lista.querySelectorAll('.ger-conta').forEach((el) => { el.hidden = !!q && !normaliza(el.dataset.busca).includes(q); });
          } })) : null,
          lista,
          h('label', { class: 'ger-campo' }, 'Outra conta (ID, se não estiver na lista)', campoOutras = h('input', { type: 'text', inputmode: 'numeric', value: extras.join(', '), placeholder: 'Ex.: 1234567890123456' }))),
        h('label', { class: 'ger-campo' }, 'Ticket médio em R$ (opcional)', campoTicket = h('input', { type: 'text', inputmode: 'decimal', value: f.ticket || '', placeholder: 'Ex.: 1500' })),
        h('label', { class: 'ger-check' }, campoLink = h('input', { type: 'checkbox', checked: f.link !== false }), 'Cliente recebe o link do próprio painel'),
        h('div', { class: 'acoes' },
          h('button', { class: 'btn dark', type: 'submit', disabled: ger.salvando }, f.novo ? 'Adicionar cliente' : 'Salvar mudanças'),
          h('button', { class: 'btn', type: 'button', onclick: () => { ger.form = null; ger.msg = null; renderGerenciar(); } }, 'Cancelar')));
    }

    let largura = window.innerWidth;
    window.addEventListener('resize', () => { if (estado.aberto && estado.aberto !== GER && Math.abs(window.innerWidth - largura) > 40) { largura = window.innerWidth; if (desenharGraficos) desenharGraficos(); } });

    render();
    return (novos) => { estado.dados = novos; render(); if (estado.aberto === GER) gerAtualizado(); };
  }

  // =====================================================================
  // Visão do cliente
  // =====================================================================
  function iniciaCliente(dados) {
    MOEDA = dados.cliente.moeda || 'BRL';
    document.title = dados.cliente.nome + ' · Resultados';
    document.body.classList.add('cliente');
    const permitidos = ['ontem', '7d', 'mes', '30d', 'mesant'];
    const estado = { pk: lePref('periodo', '30d'), dados };
    if (!permitidos.includes(estado.pk) || !faixas(dados.hoje)[estado.pk]) estado.pk = '30d';
    let desenhar = null;

    function barras(itens) {
      const topo = Math.max(1, ...itens.map((x) => x.v || 0));
      return h('div', { class: 'barras' }, itens.map((x) => h('div', { class: 'barra' + (x.ghl ? ' ghl' : '') },
        h('span', { class: 't' }, x.t),
        h('div', { class: 'trilho', 'aria-hidden': 'true' }, h('div', { class: 'cheio', style: 'width:' + Math.max(0.6, ((x.v || 0) / topo) * 100).toFixed(1) + '%' })),
        h('span', { class: 'n' }, x.v == null ? '–' : inteiro(x.v), x.x ? h('span', { class: 'x' }, x.x) : null))));
    }

    function render() {
      const d = estado.dados;
      const cli = { dias: d.dias, periodos: d.periodos, contas: d.contas };
      const m = calcula(cli, estado.pk, d.hoje);
      const f = m.f, c = m.cur, p = m.prev;
      const dl = (v, v0, dir) => deltaEl(delta(v, p ? v0 : null, dir));
      const ghl = d.ghl && d.ghl.conectado;
      const contatoNoMeta = m.tipo ? m.tipo.contato : true;

      const header = h('header', { class: 'top hero' },
        h('div', null, h('p', { class: 'eyebrow' }, 'Resultados de tráfego pago'), h('h1', null, d.cliente.nome)),
        h('div', { class: 'por' }, 'Atualizado em ' + quando(d.geradoEm), h('br'), 'Acompanhamento ' + (d.agencia || '')));
      const controles = h('section', { class: 'controls', 'aria-label': 'Período' },
        seletorPeriodo(estado, permitidos, d.hoje, (k) => { estado.pk = k; gravaPref('periodo', k); render(); }),
        faixaEl(f));

      const principal = m.tipo && !m.tipo.contato && m.curT
        ? tile(m.tipo.muitos.charAt(0).toUpperCase() + m.tipo.muitos.slice(1), inteiro(m.curT.res), [dl(m.curT.res, m.prevT && m.prevT.res, 1), m.curT.custo != null ? moeda(m.curT.custo, 2) + ' cada' : ''])
        : tile('Contatos recebidos', inteiro(c.contatos), [dl(c.contatos, p && p.contatos, 1), 'formulários e conversas']);
      const tiles = [
        tile('Valor investido', moeda(c.inv), [dl(c.inv, p && p.inv, 0), p ? 'vs período anterior' : '']),
        principal,
        contatoNoMeta
          ? tile('Custo por contato', moeda(m.custoContato, 2), [dl(m.custoContato, m.custoContato0, -1), 'quanto custou cada contato'])
          : tile('Contatos recebidos', inteiro(c.contatos), [dl(c.contatos, p && p.contatos, 1), 'formulários e conversas']),
        m.alcance ? tile('Pessoas alcançadas', inteiro(m.alcance[0]), [dl(m.alcance[0], m.alcance[1], 1), 'viram seus anúncios']) : tile('Cliques nos anúncios', inteiro(c.cliques), [dl(c.cliques, p && p.cliques, 1), 'pessoas que clicaram'])
      ];
      if (ghl) {
        tiles.push(
          tile('Agendamentos', c.ag == null ? '–' : inteiro(c.ag), c.ag == null ? 'em configuração' : [dl(c.ag, p && p.ag, 1), 'custo ' + moeda(div(c.inv, c.ag), 2)], c.ag == null),
          tile('Comparecimentos', c.cp == null ? '–' : inteiro(c.cp), c.cp == null ? 'em configuração' : [dl(c.cp, p && p.cp, 1), pct(div(c.cp, c.ag)) + ' dos agendados'], c.cp == null),
          tile('Vendas', inteiro(c.vd), [dl(c.vd, p && p.vd, 1), 'custo por venda ' + moeda(div(c.inv, c.vd), 2)]),
          tile('Faturamento gerado', moeda(c.rc), [dl(c.rc, p && p.rc, 1), div(c.rc, c.inv) ? 'cada R$ 1 investido virou ' + moeda(div(c.rc, c.inv), 2) : ''])
        );
      }
      const kpis = h('section', { class: 'kpis', 'aria-label': 'Resumo do período' }, tiles);

      let funil;
      if (ghl) {
        funil = h('section', { class: 'funil', 'aria-labelledby': 'tFunil' },
          h('div', { class: 'hd' }, h('h2', { id: 'tFunil' }, 'Do anúncio à venda'), h('span', { class: 'hint' }, 'pessoas que chegaram no período e até onde foram')),
          barras([
            { t: 'Contatos recebidos', v: c.contatos },
            { t: 'Entraram no atendimento', v: c.opp, ghl: true, x: pct(div(c.opp, c.contatos)) + ' dos contatos' },
            c.ag != null ? { t: 'Agendaram', v: c.ag, ghl: true, x: pct(div(c.ag, c.opp)) + ' do atendimento' } : null,
            c.cp != null ? { t: 'Compareceram', v: c.cp, ghl: true, x: pct(div(c.cp, c.ag)) + ' dos agendados' } : null,
            { t: 'Compraram', v: c.vd, ghl: true, x: pct(div(c.vd, c.cp != null ? c.cp : c.ag != null ? c.ag : c.opp)) + (c.cp != null ? ' dos que vieram' : ' do passo anterior') }
          ].filter(Boolean)));
      } else {
        const alc = m.alcance ? m.alcance[0] : null;
        funil = h('section', { class: 'funil', 'aria-labelledby': 'tFunil' },
          h('div', { class: 'hd' }, h('h2', { id: 'tFunil' }, 'Do anúncio ao contato'), h('span', { class: 'hint' }, 'o caminho das pessoas até chamar você')),
          h('p', null, [alc ? inteiro(alc) + ' pessoas viram seus anúncios' : null, inteiro(c.cliques) + ' clicaram' + (c.impr ? ' (' + pct(div(c.cliques, c.impr)) + ' das exibições)' : ''), inteiro(c.contatos) + ' entraram em contato' + (c.cliques ? ' (' + pct(div(c.contatos, c.cliques)) + ' dos cliques)' : '')].filter(Boolean).join(' · ') + '.'));
      }
      const graf = blocoGraficos(cli, f, d.hoje, ghl);
      const camps = h('section', { class: 'sec camps', 'aria-labelledby': 'tCamps' },
        h('div', { class: 'sechead' }, h('h2', { id: 'tCamps' }, 'Campanhas no período'), h('span', { class: 'hint' }, 'o que rodou e quanto custou cada resultado')),
        tabelaCampanhas(m, { comConta: false, orcamento: false }));
      const rodape = h('footer', { class: 'foot' },
        h('p', null, 'Números do Meta Ads' + (ghl ? ' e do seu CRM' : '') + ', atualizados de hora em hora. Os períodos usam dias completos até ontem.'),
        h('p', null, h('b', null, 'Contatos recebidos'), ' são as pessoas que preencheram o formulário ou começaram uma conversa pelo anúncio.' + (ghl ? ' O funil acompanha quem chegou no período, então agendamentos e vendas desse grupo ainda podem aumentar nos próximos dias.' : '')));
      app.replaceChildren(...[header, avisoEl(d), controles, kpis, funil, h('section', { class: 'sec' }, graf.bloco), camps, rodape].filter(Boolean));
      desenhar = graf.desenhar;
      requestAnimationFrame(() => desenhar && desenhar());
    }
    let largura = window.innerWidth;
    window.addEventListener('resize', () => { if (Math.abs(window.innerWidth - largura) > 40) { largura = window.innerWidth; if (desenhar) desenhar(); } });
    render();
    return (novos) => { estado.dados = novos; render(); };
  }

  // ---------- Início ----------
  async function inicia() {
    const cred = lerLink();
    if (!cred) { mostraErro('link'); return; }
    let dados;
    try { dados = await baixa(cred); }
    catch (e) { mostraErro(e.message, () => inicia()); return; }
    if ((MODO === 'cliente') !== (dados.tipo === 'cliente')) { mostraErro('chave'); return; }
    // Depois de salvar a lista de clientes, confere a cada 15 segundos (por até 6 minutos) se o painel já atualizou
    let rapido = null;
    const acelera = () => {
      if (rapido) clearInterval(rapido);
      let voltas = 0;
      rapido = setInterval(async () => {
        voltas++;
        try {
          const novos = await baixa(cred);
          if (novos.geradoEm !== dados.geradoEm) { dados = novos; atualiza(novos); clearInterval(rapido); rapido = null; return; }
        } catch (e) { /* tenta na próxima volta */ }
        if (voltas >= 24) { clearInterval(rapido); rapido = null; }
      }, 15000);
    };
    const atualiza = MODO === 'cliente' ? iniciaCliente(dados) : iniciaGerente(dados, cred, acelera);
    // Atualização contínua: confere a cada 10 minutos se saiu um arquivo novo
    setInterval(async () => {
      if (document.hidden) return;
      try {
        const novos = await baixa(cred);
        if (novos.geradoEm !== dados.geradoEm) { dados = novos; atualiza(novos); return; }
      } catch (e) { /* mantém os dados que já estão na tela */ }
      // Sem arquivo novo: no gestor, avisa se a atualização automática passou da hora (sem redesenhar a tela)
      const el = MODO === 'cliente' ? null : document.querySelector('.fresh');
      if (el) {
        const fr = textoFresh(dados.geradoEm);
        el.classList.toggle('atrasada', fr.atrasada);
        const span = el.querySelector('span');
        if (span) span.textContent = fr.texto;
      }
    }, 600000);
  }
  window.addEventListener('hashchange', () => location.reload());
  inicia();
})();
