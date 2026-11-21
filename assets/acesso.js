// Gera o segredo dos links e calcula o link do gestor a partir do PAINEL_SEGREDO, do mesmo jeito que o coletor faz.
(() => {
  'use strict';
  const enc = new TextEncoder();
  const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  async function credencial(segredo, rotulo) {
    const ikm = await crypto.subtle.importKey('raw', enc.encode(segredo), 'HKDF', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: enc.encode('painel-resultados'), info: enc.encode(rotulo) }, ikm, 256);
    const hk = await crypto.subtle.importKey('raw', enc.encode(segredo), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', hk, enc.encode(rotulo));
    return { id: b64url(sig).slice(0, 16), chave: b64url(bits) };
  }

  async function copia(texto, alvo, aviso, ok) {
    try { await navigator.clipboard.writeText(texto); aviso.textContent = ok; }
    catch (e) {
      const r = document.createRange();
      r.selectNodeContents(alvo);
      const s = window.getSelection();
      s.removeAllRanges();
      s.addRange(r);
      aviso.textContent = 'Selecionado: copie com Ctrl+C';
    }
  }

  // Segredo novo: 36 bytes aleatórios viram 48 caracteres (letras, números, - e _)
  const novo = document.getElementById('novo');
  const acoesNovo = document.getElementById('acoes-novo');
  const avisoNovo = document.getElementById('aviso-novo');
  document.getElementById('gerar').addEventListener('click', () => {
    const bytes = new Uint8Array(36);
    crypto.getRandomValues(bytes);
    novo.textContent = b64url(bytes);
    novo.hidden = false;
    acoesNovo.hidden = false;
    avisoNovo.textContent = '';
  });
  document.getElementById('copiar-novo').addEventListener('click', () => copia(novo.textContent, novo, avisoNovo, 'Segredo copiado'));

  // Link do gestor
  const form = document.getElementById('form');
  const saida = document.getElementById('saida');
  const acoes = document.getElementById('acoes');
  const abrir = document.getElementById('abrir');
  const aviso = document.getElementById('aviso');
  let link = '';

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const segredo = document.getElementById('segredo').value.trim();
    const versao = Math.max(1, parseInt(document.getElementById('versao').value, 10) || 1);
    if (segredo.length < 24) { saida.hidden = false; saida.textContent = 'O segredo precisa ter pelo menos 24 caracteres.'; return; }
    const cred = await credencial(segredo, 'gerente:v' + versao);
    link = new URL('g/#' + cred.id + '.' + cred.chave, location.href).href;
    saida.hidden = false;
    saida.textContent = link;
    acoes.hidden = false;
    abrir.href = link;
    document.getElementById('segredo').value = '';
  });

  document.getElementById('copiar').addEventListener('click', () => copia(link, saida, aviso, 'Link copiado'));
})();
