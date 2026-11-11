// ImobChat Worker API — Cloudflare Workers + D1 + R2 + Mercado Pago
// Deploy: npx wrangler deploy worker-api.js
// Env bindings: DB (D1), IMAGENS (R2), MP_ACCESS_TOKEN (secret), MP_WEBHOOK_SECRET

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    // GET /api/imoveis — FIFO
    if (url.pathname === '/api/imoveis' && request.method === 'GET') {
      const { results } = await env.DB.prepare(`SELECT im.*, an.nome as anunciante_nome, an.slug, an.plano, an.whatsapp, an.foto_perfil FROM imoveis im JOIN anunciantes an ON an.id = im.anunciante_id WHERE im.ativo=1 ORDER BY im.criado_em ASC LIMIT 100`).all();
      return Response.json(results, { headers: cors });
    }
    // GET /api/imoveis/:id/regras
    const mRegras = url.pathname.match(/^\/api\/imoveis\/(\d+)\/regras$/);
    if (mRegras) {
      const { results } = await env.DB.prepare(`SELECT * FROM chat_bot_regras WHERE imovel_id=? ORDER BY ordem ASC`).bind(mRegras[1]).all();
      return Response.json(results, { headers: cors });
    }
    // POST /api/metricas — registrar clique / chamada
    if (url.pathname === '/api/metricas' && request.method === 'POST') {
      const b = await request.json();
      await env.DB.prepare(`INSERT INTO metricas_cliques (imovel_id, anunciante_id, tipo, ip_origem, origem) VALUES (?,?,?,?,?)`).bind(b.imovel_id||null, b.anunciante_id||null, b.tipo||'visualizacao', request.headers.get('CF-Connecting-IP')||'', b.origem||'imobchat').run();
      return Response.json({ ok: true }, { headers: cors });
    }
    // POST /api/chamadas — registrar chamada de voz/vídeo
    if (url.pathname === '/api/chamadas' && request.method === 'POST') {
      const b = await request.json();
      await env.DB.prepare(`INSERT INTO chamadas (imovel_id, anunciante_id, tipo, duracao_seg, status) VALUES (?,?,?,?,?)`).bind(b.imovel_id||null, b.anunciante_id||null, b.tipo||'audio', b.duracao_seg||0, 'finalizada').run();
      return Response.json({ ok: true }, { headers: cors });
    }
    // POST /api/checkout — criar assinatura Mercado Pago (Prata R$29,90 / Ouro R$89,90)
    if (url.pathname === '/api/checkout' && request.method === 'POST') {
      const { anunciante_id, plano } = await request.json();
      const preco = plano === 'ouro' ? 89.90 : 29.90;
      const resp = await fetch('https://api.mercadopago.com/preapproval', {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.MP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason: `ImobChat ${plano === 'ouro' ? 'Ouro' : 'Prata'} - Assinatura mensal`,
          auto_recurring: { frequency: 1, frequency_type: 'months', transaction_amount: preco, currency_id: 'BRL' },
          back_url: `${env.PUBLIC_BASE_URL}/?pagamento=ok`,
          external_reference: String(anunciante_id),
        })
      });
      const data = await resp.json();
      return Response.json({ init_point: data.init_point, id: data.id }, { headers: cors });
    }
    // POST /api/mp-webhook — Mercado Pago avisa que pagou → D1 atualiza plano automaticamente
    if (url.pathname === '/api/mp-webhook' && request.method === 'POST') {
      const body = await request.json().catch(()=>({}));
      const paymentId = body?.data?.id || body?.id;
      if (!paymentId) return Response.json({ ok: false }, { status: 400, headers: cors });
      const pay = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, { headers: { Authorization: `Bearer ${env.MP_ACCESS_TOKEN}` } }).then(r=>r.json());
      if (pay.status === 'approved') {
        const anuncianteId = pay.external_reference;
        const plano = pay.transaction_amount >= 89 ? 'ouro' : 'prata';
        await env.DB.prepare(`UPDATE anunciantes SET plano=?, plano_ate=datetime('now','+1 month') WHERE id=?`).bind(plano, anuncianteId).run();
        await env.DB.prepare(`INSERT INTO pagamentos (anunciante_id, plano, valor, mp_payment_id, status, metodo) VALUES (?,?,?,?, 'approved', ?) ON CONFLICT(mp_payment_id) DO NOTHING`).bind(anuncianteId, plano, pay.transaction_amount, String(paymentId), pay.payment_method_id||'pix').run();
      }
      return Response.json({ ok: true }, { headers: cors });
    }
    // ===== UPLOAD DE IMAGEM - SÓ OURO (Prata usa link) =====
    // POST /api/upload {nome, base64, tipo} -> salva no R2 e devolve URL pública
    if (url.pathname === '/api/upload' && request.method === 'POST') {
      try {
        const b = await request.json();
        // b.base64 = "data:image/jpeg;base64,..." ou só base64
        const base64 = (b.base64||'').split(',').pop();
        const bytes = Uint8Array.from(atob(base64), c=>c.charCodeAt(0));
        const nome = (b.nome||('img-'+Date.now()+'.jpg')).replace(/[^a-zA-Z0-9._-]/g,'');
        await env.IMAGENS.put(nome, bytes, { httpMetadata: { contentType: b.tipo||'image/jpeg' } });
        const publicUrl = (env.PUBLIC_R2_URL || '') ? (env.PUBLIC_R2_URL + '/' + nome) : ('https://' + nome);
        return Response.json({ ok: true, url: publicUrl, nome }, { headers: cors });
      } catch(e) {
        return Response.json({ ok: false, erro: String(e) }, { status: 400, headers: cors });
      }
    }
    // ===== ADMIN MASTER - SÓ DONO pode liberar plano =====
    // POST /api/admin/liberar-plano {anunciante_id ou slug, plano}
    if (url.pathname === '/api/admin/liberar-plano' && request.method === 'POST') {
      const b = await request.json();
      const plano = (b.plano||'free').toLowerCase();
      if (b.slug) await env.DB.prepare(`UPDATE anunciantes SET plano=? WHERE slug=?`).bind(plano, b.slug).run();
      else if (b.anunciante_id) await env.DB.prepare(`UPDATE anunciantes SET plano=? WHERE id=?`).bind(plano, b.anunciante_id).run();
      return Response.json({ ok: true, plano }, { headers: cors });
    }
    // GET /api/admin/metricas -> totais para o Painel Master
    if (url.pathname === '/api/admin/metricas' && request.method === 'GET') {
      const totalAnunciantes = await env.DB.prepare(`SELECT COUNT(*) as total FROM anunciantes`).first();
      const totalImoveis = await env.DB.prepare(`SELECT COUNT(*) as total FROM imoveis WHERE ativo=1`).first();
      const pagos = await env.DB.prepare(`SELECT plano, COUNT(*) as total FROM anunciantes GROUP BY plano`).all();
      return Response.json({ totalAnunciantes: totalAnunciantes?.total||0, totalImoveis: totalImoveis?.total||0, porPlano: pagos.results||[] }, { headers: cors });
    }
    // ===== CHAMADAS NATIVAS: salas + sinalização WebRTC (sem app de terceiro) =====
    // POST /api/salas {sala, imovel_id, anunciante_id, de_id, de_nome, tipo} -> cria sala única da ligação
    if (url.pathname === '/api/salas' && request.method === 'POST') {
      const b = await request.json();
      await env.DB.prepare(`INSERT OR IGNORE INTO chamadas_salas (sala, imovel_id, anunciante_id, de_id, de_nome, tipo, status) VALUES (?,?,?,?,?,?, 'tocando')`).bind(b.sala, b.imovel_id||null, b.anunciante_id||null, b.de_id||'visitante', b.de_nome||'', b.tipo||'audio').run();
      return Response.json({ ok: true, sala: b.sala }, { headers: cors });
    }
    // GET /api/salas/pendentes?imovel_id=12 -> quem está ligando para este imóvel agora
    if (url.pathname === '/api/salas/pendentes' && request.method === 'GET') {
      const imovelId = url.searchParams.get('imovel_id');
      const deId = url.searchParams.get('de_id') || '';
      const { results } = await env.DB.prepare(`SELECT * FROM chamadas_salas WHERE status='tocando' AND imovel_id=? AND de_id!=? ORDER BY id DESC LIMIT 5`).bind(imovelId, deId).all();
      return Response.json(results, { headers: cors });
    }
    // GET /api/salas/ocupado?anunciante_id=2 -> Marina está em ligação? Sim/Não
    // Se tiver sala 'tocando' ou 'atendida' para esse anunciante, ele está OCUPADO
    if (url.pathname === '/api/salas/ocupado' && request.method === 'GET') {
      const anuncianteId = url.searchParams.get('anunciante_id');
      const { results } = await env.DB.prepare(`SELECT * FROM chamadas_salas WHERE anunciante_id=? AND status IN ('tocando','atendida') ORDER BY id DESC LIMIT 1`).bind(anuncianteId).all();
      const ocupado = results.length > 0;
      return Response.json({ ocupado, sala: ocupado ? results[0] : null }, { headers: cors });
    }
    // POST /api/salas/atender {sala, status} -> atendida / recusada / encerrada
    if (url.pathname === '/api/salas/atender' && request.method === 'POST') {
      const b = await request.json();
      await env.DB.prepare(`UPDATE chamadas_salas SET status=? WHERE sala=?`).bind(b.status||'atendida', b.sala).run();
      return Response.json({ ok: true }, { headers: cors });
    }
    // POST /api/sinalizacao {sala, de_id, tipo, dados} -> offer / answer / ice
    if (url.pathname === '/api/sinalizacao' && request.method === 'POST') {
      const b = await request.json();
      await env.DB.prepare(`INSERT INTO sinalizacao (sala, de_id, tipo, dados) VALUES (?,?,?,?)`).bind(b.sala, b.de_id, b.tipo, typeof b.dados==='string' ? b.dados : JSON.stringify(b.dados)).run();
      return Response.json({ ok: true }, { headers: cors });
    }
    // GET /api/sinalizacao?sala=xxx&depois_de=0 -> mensagens novas da sala (polling)
    if (url.pathname === '/api/sinalizacao' && request.method === 'GET') {
      const sala = url.searchParams.get('sala') || '';
      const depois = parseInt(url.searchParams.get('depois_de') || '0');
      const { results } = await env.DB.prepare(`SELECT * FROM sinalizacao WHERE sala=? AND id>? ORDER BY id ASC LIMIT 50`).bind(sala, depois).all();
      return Response.json(results, { headers: cors });
    }
    return new Response('ImobChat API online — /api/imoveis', { headers: cors });
  }
};
