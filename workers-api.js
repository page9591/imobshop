// ChatImov / ImobChat — Worker API OFICIAL (D1 + R2 + Mercado Pago)
// BANCO É A VERDADE: 1 e-mail = 1 perfil. Nada fica só no celular.
// Deploy: npx wrangler deploy
// Env: DB (D1), IMAGENS (R2), MP_ACCESS_TOKEN, MP_WEBHOOK_SECRET, PUBLIC_BASE_URL, PUBLIC_R2_URL
// Admin: pagenegocio@gmail.com vê tudo.

const ADMIN_EMAIL = 'pagenegocio@gmail.com';

async function sha256(text){
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text||''));
  return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
function limpaEmail(e){ return (e||'').trim().toLowerCase(); }
function slugDe(nome){
  return (nome||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,'-').replace(/[^a-z0-9-]/g,'') || ('user-'+Date.now());
}
function publicAnunciante(r){
  if(!r) return null;
  const {senha_hash, ...resto} = r;
  return resto;
}

export default {
  async fetch(request, env){
    const url = new URL(request.url);
    const cors = { 'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Methods':'GET,POST,PUT,DELETE,OPTIONS', 'Access-Control-Allow-Headers':'Content-Type, Authorization' };
    if(request.method==='OPTIONS') return new Response(null, {headers:cors});
    const json = (obj, status=200)=> Response.json(obj, {status, headers:cors});
    const erro = (msg, status=400)=> json({ok:false, erro:msg}, status);
    try{

    // ===== PING — pra saber se o banco está no ar =====
    if(url.pathname==='/api/ping') return json({ok:true, banco:'D1', hora:new Date().toISOString()});

    // ===== AUTH — CADASTRO =====
    // POST /api/auth/cadastro {email, senha, nome, whatsapp, tipo, cidade, estado}
    if(url.pathname==='/api/auth/cadastro' && request.method==='POST'){
      const b = await request.json().catch(()=>({}));
      const email = limpaEmail(b.email);
      const senha = (b.senha||'').trim();
      const nome = (b.nome||'').trim();
      const whatsapp = (b.whatsapp||'').replace(/[^0-9]/g,'');
      const tipo = (b.tipo||'corretor').toLowerCase()==='imobiliaria' ? 'imobiliaria' : 'corretor';
      const cidade = (b.cidade||'').trim();
      const estado = (b.estado||'').trim().toUpperCase().slice(0,2);
      if(!email || !email.includes('@')) return erro('Digite seu e-mail certinho, com @.');
      if(!senha || senha.length<4) return erro('Senha com pelo menos 4 letras.');
      if(!nome) return erro('Coloque seu nome.');
      if(!whatsapp || whatsapp.length<10) return erro('Coloque seu WhatsApp com DDD.');
      const existe = await env.DB.prepare(`SELECT id FROM anunciantes WHERE LOWER(TRIM(email))=?`).bind(email).first();
      if(existe) return erro('Essa conta já existe. Toque em "Já tenho conta • Entrar".', 409);
      let slug = slugDe(nome);
      // Se slug já existe, adiciona número
      const slugExiste = await env.DB.prepare(`SELECT id FROM anunciantes WHERE slug=?`).bind(slug).first();
      if(slugExiste) slug = slug + '-' + Date.now().toString().slice(-4);
      const senhaHash = await sha256(senha);
      const bio = (tipo==='imobiliaria' ? 'Imobiliária' : 'Corretor') + (cidade ? ' em '+cidade : ' em São Paulo') + ' • ' + nome;
      const r = await env.DB.prepare(`INSERT INTO anunciantes (email, senha_hash, slug, nome, whatsapp, tipo, cidade, estado, plano, bio, foto_perfil, ativo) VALUES (?,?,?,?,?,?,?,?, 'free', ?, 'https://images.unsplash.com/photo-1633332755192-727a05c4013d?w=300&q=80', 1)`).bind(email, senhaHash, slug, nome, whatsapp, tipo, cidade, estado, bio).run();
      const novo = await env.DB.prepare(`SELECT id, email, slug, nome, whatsapp, tipo, cidade, estado, plano, bio, foto_perfil, capa_url, ativo FROM anunciantes WHERE id=?`).bind(r.meta.last_row_id).first();
      return json({ok:true, anunciante:novo});
    }

    // ===== AUTH — LOGIN =====
    // POST /api/auth/login {email, senha} — busca POR E-MAIL, nunca por id=1
    if(url.pathname==='/api/auth/login' && request.method==='POST'){
      const b = await request.json().catch(()=>({}));
      const email = limpaEmail(b.email);
      const senha = (b.senha||'').trim();
      if(!email || !senha) return erro('E-mail e senha.');
      const row = await env.DB.prepare(`SELECT * FROM anunciantes WHERE LOWER(TRIM(email))=?`).bind(email).first();
      if(!row) return erro('Nenhuma conta com esse e-mail neste banco. Toque em "Não tenho conta • Abrir conta".', 404);
      if(row.ativo===0) return erro('Conta excluída pelo admin.', 403);
      // Conta antiga sem senha_hash (veio do schema inicial) — aceita 1 vez e já grava a senha
      if(!row.senha_hash){
        const nh = await sha256(senha);
        await env.DB.prepare(`UPDATE anunciantes SET senha_hash=? WHERE id=?`).bind(nh, row.id).run();
      } else {
        const h = await sha256(senha);
        if(h !== row.senha_hash) return erro('Senha errada. Tente de novo ou toque em "Esqueci minha senha?".', 401);
      }
      return json({ok:true, anunciante: publicAnunciante(row)});
    }

    // ===== RECUPERAR SENHA =====
    // POST /api/auth/recuperar {email, novaSenha}
    if(url.pathname==='/api/auth/recuperar' && request.method==='POST'){
      const b = await request.json().catch(()=>({}));
      const email = limpaEmail(b.email);
      const nova = (b.novaSenha||'').trim();
      if(!email || nova.length<4) return erro('E-mail e nova senha (mín. 4 letras).');
      const row = await env.DB.prepare(`SELECT id FROM anunciantes WHERE LOWER(TRIM(email))=?`).bind(email).first();
      if(!row) return erro('Nenhuma conta com esse e-mail.', 404);
      await env.DB.prepare(`UPDATE anunciantes SET senha_hash=? WHERE id=?`).bind(await sha256(nova), row.id).run();
      return json({ok:true});
    }

    // ===== PERFIL — LER =====
    // GET /api/anunciantes/me?email=...
    if(url.pathname==='/api/anunciantes/me' && request.method==='GET'){
      const email = limpaEmail(url.searchParams.get('email'));
      const row = await env.DB.prepare(`SELECT id, email, slug, nome, whatsapp, tipo, cidade, estado, plano, bio, foto_perfil, capa_url, ativo FROM anunciantes WHERE LOWER(TRIM(email))=?`).bind(email).first();
      if(!row) return erro('Conta não encontrada', 404);
      return json({ok:true, anunciante:row});
    }
    // GET /api/anunciantes/:slug — perfil público (visitante da Bahia vê o corretor)
    const mSlug = url.pathname.match(/^\/api\/anunciantes\/([a-z0-9-]+)$/);
    if(mSlug && request.method==='GET'){
      const row = await env.DB.prepare(`SELECT id, email, slug, nome, whatsapp, tipo, cidade, estado, plano, bio, foto_perfil, capa_url FROM anunciantes WHERE slug=? AND ativo=1`).bind(mSlug[1]).first();
      if(!row) return erro('Perfil não encontrado', 404);
      // Não devolve e-mail no perfil público
      delete row.email;
      return json({ok:true, anunciante:row});
    }

    // ===== PERFIL — SALVAR =====
    // PUT /api/anunciantes/me {email, nome, whatsapp, bio, foto_perfil, capa_url, cidade, estado, tipo}
    if(url.pathname==='/api/anunciantes/me' && request.method==='PUT'){
      const b = await request.json().catch(()=>({}));
      const email = limpaEmail(b.email);
      if(!email) return erro('E-mail obrigatório');
      await env.DB.prepare(`UPDATE anunciantes SET nome=COALESCE(NULLIF(?,''),nome), whatsapp=COALESCE(NULLIF(?,''),whatsapp), bio=COALESCE(?,bio), foto_perfil=COALESCE(NULLIF(?,''),foto_perfil), capa_url=COALESCE(?,capa_url), cidade=COALESCE(?,cidade), estado=COALESCE(?,estado), tipo=COALESCE(?,tipo), atualizado_em=datetime('now') WHERE LOWER(TRIM(email))=?`).bind(b.nome||'', b.whatsapp||'', b.bio ?? null, b.foto_perfil||'', b.capa_url ?? null, b.cidade ?? null, b.estado ?? null, b.tipo || null, email).run();
      const row = await env.DB.prepare(`SELECT id, email, slug, nome, whatsapp, tipo, cidade, estado, plano, bio, foto_perfil, capa_url FROM anunciantes WHERE LOWER(TRIM(email))=?`).bind(email).first();
      return json({ok:true, anunciante:row});
    }

    // ===== IMÓVEIS — PÚBLICO (visitante vê todos, de todos os estados) =====
    // GET /api/imoveis?cidade=&estado=&busca= — FIFO, todos ativos
    if(url.pathname==='/api/imoveis' && request.method==='GET'){
      const cidade = url.searchParams.get('cidade')||'';
      const estado = (url.searchParams.get('estado')||'').toUpperCase();
      const busca = (url.searchParams.get('busca')||'').trim().toLowerCase();
      let sql = `SELECT im.*, an.nome as anunciante_nome, an.slug, an.plano, an.whatsapp, an.foto_perfil, an.cidade as anunciante_cidade, an.estado as anunciante_estado FROM imoveis im JOIN anunciantes an ON an.id=im.anunciante_id WHERE im.ativo=1 AND an.ativo=1`;
      const binds = [];
      if(cidade){ sql += ` AND LOWER(im.cidade)=LOWER(?)`; binds.push(cidade); }
      if(estado){ sql += ` AND UPPER(im.estado)=?`; binds.push(estado); }
      if(busca){ sql += ` AND (LOWER(im.titulo) LIKE ? OR LOWER(im.bairro) LIKE ? OR LOWER(im.cidade) LIKE ?)`; binds.push(`%${busca}%`, `%${busca}%`, `%${busca}%`); }
      sql += ` ORDER BY im.criado_em ASC LIMIT 200`;
      const {results} = await env.DB.prepare(sql).bind(...binds).all();
      return json(results);
    }
    // GET /api/meus-imoveis?email=... — só os MEUS
    if(url.pathname==='/api/meus-imoveis' && request.method==='GET'){
      const email = limpaEmail(url.searchParams.get('email'));
      const an = await env.DB.prepare(`SELECT id FROM anunciantes WHERE LOWER(TRIM(email))=?`).bind(email).first();
      if(!an) return json([]);
      const {results} = await env.DB.prepare(`SELECT * FROM imoveis WHERE anunciante_id=? AND ativo=1 ORDER BY criado_em ASC`).bind(an.id).all();
      return json(results);
    }
    // POST /api/imoveis {email, titulo, preco, bairro, cidade, estado, ...} — cria com anunciante_id DO E-MAIL
    if(url.pathname==='/api/imoveis' && request.method==='POST'){
      const b = await request.json().catch(()=>({}));
      const email = limpaEmail(b.email);
      const an = await env.DB.prepare(`SELECT id, plano FROM anunciantes WHERE LOWER(TRIM(email))=?`).bind(email).first();
      if(!an) return erro('Conta não encontrada', 404);
      if(!b.titulo || !b.preco || !b.bairro) return erro('Preencha título, preço e bairro.');
      // Limite Free: 15 anúncios
      if(an.plano==='free'){
        const c = await env.DB.prepare(`SELECT COUNT(*) as total FROM imoveis WHERE anunciante_id=? AND ativo=1`).bind(an.id).first();
        if((c?.total||0) >= 15) return erro('Limite Free: 15 anúncios. Faça upgrade para ilimitado.', 403);
      }
      const r = await env.DB.prepare(`INSERT INTO imoveis (anunciante_id, titulo, preco, bairro, cidade, estado, tipo, area, quartos, banheiros, descricao, fotos_json, ativo) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1)`).bind(an.id, b.titulo, Number(b.preco||0), b.bairro, b.cidade||'São Paulo', (b.estado||'SP').toUpperCase(), b.tipo||'Apartamento', Number(b.area||0), Number(b.quartos||1), Number(b.banheiros||1), b.descricao||'', JSON.stringify(b.fotos||[])).run();
      return json({ok:true, id:r.meta.last_row_id, anunciante_id:an.id});
    }
    // DELETE /api/imoveis/:id?email=... — só o dono apaga o seu
    const mDel = url.pathname.match(/^\/api\/imoveis\/(\d+)$/);
    if(mDel && request.method==='DELETE'){
      const email = limpaEmail(url.searchParams.get('email'));
      const an = await env.DB.prepare(`SELECT id FROM anunciantes WHERE LOWER(TRIM(email))=?`).bind(email).first();
      if(!an) return erro('Conta não encontrada', 404);
      const im = await env.DB.prepare(`SELECT id, anunciante_id FROM imoveis WHERE id=?`).bind(mDel[1]).first();
      if(!im) return erro('Imóvel não encontrado', 404);
      if(im.anunciante_id !== an.id && email !== ADMIN_EMAIL) return erro('Você só pode apagar o seu anúncio.', 403);
      await env.DB.prepare(`UPDATE imoveis SET ativo=0 WHERE id=?`).bind(mDel[1]).run();
      return json({ok:true});
    }
    // GET /api/imoveis/:id/regras
    const mRegras = url.pathname.match(/^\/api\/imoveis\/(\d+)\/regras$/);
    if(mRegras && request.method==='GET'){
      const {results} = await env.DB.prepare(`SELECT * FROM chat_bot_regras WHERE imovel_id=? ORDER BY ordem ASC`).bind(mRegras[1]).all();
      return json(results);
    }

    // ===== LEADS =====
    // POST /api/leads {email_corretor, imovel_id, imovel_titulo, nome, whatsapp} — cai no corretor DO ANÚNCIO
    // Se vier imovel_id, usa o anunciante DO IMÓVEL (mais seguro que e-mail). Se vier só e-mail, usa o e-mail.
    if(url.pathname==='/api/leads' && request.method==='POST'){
      const b = await request.json().catch(()=>({}));
      const emailCorretor = limpaEmail(b.email_corretor);
      let an = null;
      if(b.imovel_id){
        const im = await env.DB.prepare(`SELECT anunciante_id FROM imoveis WHERE id=?`).bind(b.imovel_id).first();
        if(im) an = await env.DB.prepare(`SELECT id, nome FROM anunciantes WHERE id=?`).bind(im.anunciante_id).first();
      }
      if(!an && emailCorretor) an = await env.DB.prepare(`SELECT id, nome FROM anunciantes WHERE LOWER(TRIM(email))=?`).bind(emailCorretor).first();
      if(!an) return erro('Corretor não encontrado', 404);
      if(!b.nome || !b.whatsapp) return erro('Nome e WhatsApp do visitante.');
      await env.DB.prepare(`INSERT INTO leads (anunciante_id, imovel_id, imovel_titulo, nome, whatsapp, corretor_nome) VALUES (?,?,?,?,?,?)`).bind(an.id, b.imovel_id||null, b.imovel_titulo||'', b.nome, b.whatsapp.replace(/[^0-9]/g,''), an.nome).run();
      return json({ok:true});
    }
    // GET /api/leads?email=... — admin vê TODOS, resto vê só os seus
    if(url.pathname==='/api/leads' && request.method==='GET'){
      const email = limpaEmail(url.searchParams.get('email'));
      if(email===ADMIN_EMAIL){
        const {results} = await env.DB.prepare(`SELECT * FROM leads ORDER BY criado_em DESC LIMIT 500`).all();
        return json(results);
      }
      const an = await env.DB.prepare(`SELECT id FROM anunciantes WHERE LOWER(TRIM(email))=?`).bind(email).first();
      if(!an) return json([]);
      const {results} = await env.DB.prepare(`SELECT * FROM leads WHERE anunciante_id=? ORDER BY criado_em DESC LIMIT 200`).bind(an.id).all();
      return json(results);
    }

    // ===== MÉTRICAS / CHAMADAS =====
    if(url.pathname==='/api/metricas' && request.method==='POST'){
      const b = await request.json().catch(()=>({}));
      await env.DB.prepare(`INSERT INTO metricas_cliques (imovel_id, anunciante_id, tipo, ip_origem, origem) VALUES (?,?,?,?,?)`).bind(b.imovel_id||null, b.anunciante_id||null, b.tipo||'visualizacao', request.headers.get('CF-Connecting-IP')||'', b.origem||'imobchat').run();
      return json({ok:true});
    }
    if(url.pathname==='/api/chamadas' && request.method==='POST'){
      const b = await request.json().catch(()=>({}));
      await env.DB.prepare(`INSERT INTO chamadas (imovel_id, anunciante_id, tipo, duracao_seg, status) VALUES (?,?,?,?,?)`).bind(b.imovel_id||null, b.anunciante_id||null, b.tipo||'audio', b.duracao_seg||0, 'finalizada').run();
      return json({ok:true});
    }

    // ===== CHECKOUT / WEBHOOK MP =====
    if(url.pathname==='/api/checkout' && request.method==='POST'){
      const {anunciante_id, plano} = await request.json().catch(()=>({}));
      const preco = plano==='ouro' ? 89.90 : 29.90;
      const resp = await fetch('https://api.mercadopago.com/preapproval', {method:'POST', headers:{Authorization:`Bearer ${env.MP_ACCESS_TOKEN}`, 'Content-Type':'application/json'}, body: JSON.stringify({reason:`ChatImov ${plano==='ouro'?'Ouro':'Prata'} - Assinatura mensal`, auto_recurring:{frequency:1, frequency_type:'months', transaction_amount:preco, currency_id:'BRL'}, back_url:`${env.PUBLIC_BASE_URL}/?pagamento=ok`, external_reference:String(anunciante_id)})});
      const data = await resp.json().catch(()=>({}));
      return json({init_point:data.init_point, id:data.id});
    }
    if(url.pathname==='/api/mp-webhook' && request.method==='POST'){
      const body = await request.json().catch(()=>({}));
      const paymentId = body?.data?.id || body?.id;
      if(!paymentId) return json({ok:false}, 400);
      const pay = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {headers:{Authorization:`Bearer ${env.MP_ACCESS_TOKEN}`}}).then(r=>r.json()).catch(()=>({}));
      if(pay.status==='approved'){
        const anuncianteId = pay.external_reference;
        const plano = pay.transaction_amount >= 89 ? 'ouro' : 'prata';
        await env.DB.prepare(`UPDATE anunciantes SET plano=?, plano_ate=datetime('now','+1 month') WHERE id=?`).bind(plano, anuncianteId).run();
        await env.DB.prepare(`INSERT INTO pagamentos (anunciante_id, plano, valor, mp_payment_id, status, metodo) VALUES (?,?,?,?, 'approved', ?) ON CONFLICT(mp_payment_id) DO NOTHING`).bind(anuncianteId, plano, pay.transaction_amount, String(paymentId), pay.payment_method_id||'pix').run();
      }
      return json({ok:true});
    }

    // ===== UPLOAD R2 =====
    if(url.pathname==='/api/upload' && request.method==='POST'){
      try{
        const b = await request.json().catch(()=>({}));
        const base64 = (b.base64||'').split(',').pop();
        const bytes = Uint8Array.from(atob(base64), c=>c.charCodeAt(0));
        const nome = (b.nome||('img-'+Date.now()+'.jpg')).replace(/[^a-zA-Z0-9._-]/g,'');
        await env.IMAGENS.put(nome, bytes, {httpMetadata:{contentType:b.tipo||'image/jpeg'}});
        const publicUrl = env.PUBLIC_R2_URL ? (env.PUBLIC_R2_URL + '/' + nome) : ('https://' + nome);
        return json({ok:true, url:publicUrl, nome});
      }catch(e){ return json({ok:false, erro:String(e)}, 400); }
    }

    // ===== ADMIN MASTER — só pagenegocio =====
    if(url.pathname==='/api/admin/liberar-plano' && request.method==='POST'){
      const b = await request.json().catch(()=>({}));
      const plano = (b.plano||'free').toLowerCase();
      if(b.slug) await env.DB.prepare(`UPDATE anunciantes SET plano=? WHERE slug=?`).bind(plano, b.slug).run();
      else if(b.anunciante_id) await env.DB.prepare(`UPDATE anunciantes SET plano=? WHERE id=?`).bind(plano, b.anunciante_id).run();
      else if(b.email) await env.DB.prepare(`UPDATE anunciantes SET plano=? WHERE LOWER(TRIM(email))=?`).bind(plano, limpaEmail(b.email)).run();
      return json({ok:true, plano});
    }
    if(url.pathname==='/api/admin/anunciantes' && request.method==='GET'){
      const email = limpaEmail(url.searchParams.get('email'));
      if(email!==ADMIN_EMAIL) return erro('Só o admin', 403);
      const {results} = await env.DB.prepare(`SELECT id, email, slug, nome, whatsapp, tipo, cidade, estado, plano, bio, foto_perfil, capa_url, ativo, criado_em FROM anunciantes ORDER BY criado_em DESC LIMIT 500`).all();
      return json(results);
    }
    if(url.pathname==='/api/admin/excluir' && request.method==='POST'){
      const b = await request.json().catch(()=>({}));
      const emailAdmin = limpaEmail(b.admin_email);
      if(emailAdmin!==ADMIN_EMAIL) return erro('Só o admin', 403);
      await env.DB.prepare(`UPDATE anunciantes SET ativo=0 WHERE id=?`).bind(b.anunciante_id).run();
      return json({ok:true});
    }
    if(url.pathname==='/api/admin/metricas' && request.method==='GET'){
      const totalAnunciantes = await env.DB.prepare(`SELECT COUNT(*) as total FROM anunciantes WHERE ativo=1`).first();
      const totalImoveis = await env.DB.prepare(`SELECT COUNT(*) as total FROM imoveis WHERE ativo=1`).first();
      const pagos = await env.DB.prepare(`SELECT plano, COUNT(*) as total FROM anunciantes WHERE ativo=1 GROUP BY plano`).all();
      return json({totalAnunciantes:totalAnunciantes?.total||0, totalImoveis:totalImoveis?.total||0, porPlano:pagos.results||[]});
    }

    // ===== SALAS / SINALIZAÇÃO =====
    if(url.pathname==='/api/salas' && request.method==='POST'){
      const b = await request.json().catch(()=>({}));
      await env.DB.prepare(`INSERT OR IGNORE INTO chamadas_salas (sala, imovel_id, anunciante_id, de_id, de_nome, tipo, status) VALUES (?,?,?,?,?,?, 'tocando')`).bind(b.sala, b.imovel_id||null, b.anunciante_id||null, b.de_id||'visitante', b.de_nome||'', b.tipo||'audio').run();
      return json({ok:true, sala:b.sala});
    }
    if(url.pathname==='/api/salas/pendentes' && request.method==='GET'){
      const imovelId = url.searchParams.get('imovel_id');
      const deId = url.searchParams.get('de_id')||'';
      const {results} = await env.DB.prepare(`SELECT * FROM chamadas_salas WHERE status='tocando' AND imovel_id=? AND de_id!=? ORDER BY id DESC LIMIT 5`).bind(imovelId, deId).all();
      return json(results);
    }
    if(url.pathname==='/api/salas/ocupado' && request.method==='GET'){
      const anuncianteId = url.searchParams.get('anunciante_id');
      const {results} = await env.DB.prepare(`SELECT * FROM chamadas_salas WHERE anunciante_id=? AND status IN ('tocando','atendida') ORDER BY id DESC LIMIT 1`).bind(anuncianteId).all();
      return json({ocupado: results.length>0, sala: results.length?results[0]:null});
    }
    if(url.pathname==='/api/salas/atender' && request.method==='POST'){
      const b = await request.json().catch(()=>({}));
      await env.DB.prepare(`UPDATE chamadas_salas SET status=? WHERE sala=?`).bind(b.status||'atendida', b.sala).run();
      return json({ok:true});
    }
    if(url.pathname==='/api/sinalizacao' && request.method==='POST'){
      const b = await request.json().catch(()=>({}));
      await env.DB.prepare(`INSERT INTO sinalizacao (sala, de_id, tipo, dados) VALUES (?,?,?,?)`).bind(b.sala, b.de_id, b.tipo, typeof b.dados==='string'?b.dados:JSON.stringify(b.dados)).run();
      return json({ok:true});
    }
    if(url.pathname==='/api/sinalizacao' && request.method==='GET'){
      const sala = url.searchParams.get('sala')||'';
      const depois = parseInt(url.searchParams.get('depois_de')||'0');
      const {results} = await env.DB.prepare(`SELECT * FROM sinalizacao WHERE sala=? AND id>? ORDER BY id ASC LIMIT 50`).bind(sala, depois).all();
      return json(results);
    }

    return new Response('ChatImov API online — /api/imoveis — banco D1', {headers:cors});
    }catch(e){
      return Response.json({ok:false, erro:String(e)}, {status:500, headers:{'Access-Control-Allow-Origin':'*'}});
    }
  }
};
