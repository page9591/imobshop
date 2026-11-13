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
    return new Response('ImobChat API online — /api/imoveis', { headers: cors });
  }
};
