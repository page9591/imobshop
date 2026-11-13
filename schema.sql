-- ============================================
-- ImobChat / ChatImov — BANCO OFICIAL (D1)
-- Público: qualquer pessoa no Brasil pode abrir conta,
-- criar anúncio e receber contato. TUDO fica aqui, não no celular.
-- Como rodar:
--   npx wrangler d1 execute imobchat-db --file=./schema.sql
-- Se já rodou o schema antigo, rode também o fix:
--   npx wrangler d1 execute imobchat-db --file=./schema-fix-email-unico.sql
-- ============================================

-- 1) ANUNCIANTES = corretores + imobiliárias + admin
-- 1 e-mail = 1 perfil. Sem isso, cai no mesmo perfil.
CREATE TABLE IF NOT EXISTS anunciantes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  senha_hash TEXT NOT NULL DEFAULT '',
  slug TEXT UNIQUE NOT NULL,
  nome TEXT NOT NULL,
  whatsapp TEXT NOT NULL,
  tipo TEXT NOT NULL DEFAULT 'corretor' CHECK (tipo IN ('corretor','imobiliaria')),
  cidade TEXT DEFAULT '',
  estado TEXT DEFAULT '',
  plano TEXT NOT NULL DEFAULT 'free' CHECK (plano IN ('free','prata','ouro')),
  plano_ate TEXT,
  bio TEXT DEFAULT '',
  foto_perfil TEXT DEFAULT '',
  capa_url TEXT DEFAULT '',
  links_extras_json TEXT DEFAULT '[]',
  palavras_chave_seo TEXT DEFAULT '',
  titulo_seo TEXT DEFAULT '',
  descricao_seo TEXT DEFAULT '',
  ativo INTEGER NOT NULL DEFAULT 1,
  mp_customer_id TEXT,
  mp_subscription_id TEXT,
  criado_em TEXT DEFAULT (datetime('now')),
  atualizado_em TEXT DEFAULT (datetime('now'))
);
-- TRAVA PRINCIPAL: 1 e-mail = 1 perfil (insensível a maiúscula / espaço)
CREATE UNIQUE INDEX IF NOT EXISTS idx_anunciantes_email_unico
  ON anunciantes(LOWER(TRIM(email)));
CREATE INDEX IF NOT EXISTS idx_anunciantes_slug ON anunciantes(slug);
CREATE INDEX IF NOT EXISTS idx_anunciantes_ativo ON anunciantes(ativo);
CREATE INDEX IF NOT EXISTS idx_anunciantes_cidade_estado ON anunciantes(cidade, estado);
CREATE INDEX IF NOT EXISTS idx_anunciantes_tipo ON anunciantes(tipo);

-- 2) IMÓVEIS — sempre ligados a um anunciante (nunca id=1 fixo)
CREATE TABLE IF NOT EXISTS imoveis (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  anunciante_id INTEGER NOT NULL REFERENCES anunciantes(id) ON DELETE CASCADE,
  titulo TEXT NOT NULL,
  preco REAL NOT NULL,
  bairro TEXT NOT NULL,
  cidade TEXT DEFAULT 'São Paulo',
  estado TEXT DEFAULT 'SP',
  tipo TEXT DEFAULT 'Apartamento',
  area REAL DEFAULT 0,
  quartos INTEGER DEFAULT 1,
  banheiros INTEGER DEFAULT 1,
  descricao TEXT DEFAULT '',
  fotos_json TEXT DEFAULT '[]',
  ativo INTEGER DEFAULT 1,
  criado_em TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_imoveis_anunciante ON imoveis(anunciante_id);
CREATE INDEX IF NOT EXISTS idx_imoveis_criado ON imoveis(criado_em ASC);
CREATE INDEX IF NOT EXISTS idx_imoveis_cidade_estado ON imoveis(cidade, estado);
CREATE INDEX IF NOT EXISTS idx_imoveis_ativo ON imoveis(ativo);

-- 3) LEADS — quem clicou no anúncio e deixou contato.
-- Vai para o corretor DO ANÚNCIO, e o admin vê todos.
CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  anunciante_id INTEGER NOT NULL REFERENCES anunciantes(id) ON DELETE CASCADE,
  imovel_id INTEGER REFERENCES imoveis(id) ON DELETE SET NULL,
  imovel_titulo TEXT DEFAULT '',
  nome TEXT NOT NULL,
  whatsapp TEXT NOT NULL,
  corretor_nome TEXT DEFAULT '',
  criado_em TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_leads_anunciante ON leads(anunciante_id);
CREATE INDEX IF NOT EXISTS idx_leads_imovel ON leads(imovel_id);
CREATE INDEX IF NOT EXISTS idx_leads_criado ON leads(criado_em DESC);

-- 4) CHATBOT — perguntas/respostas por imóvel
CREATE TABLE IF NOT EXISTS chat_bot_regras (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  imovel_id INTEGER NOT NULL REFERENCES imoveis(id) ON DELETE CASCADE,
  pergunta TEXT NOT NULL,
  resposta TEXT NOT NULL,
  ordem INTEGER DEFAULT 0,
  criado_em TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_regras_imovel ON chat_bot_regras(imovel_id);

-- 5) MÉTRICAS — cliques, visualizações
CREATE TABLE IF NOT EXISTS metricas_cliques (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  imovel_id INTEGER,
  anunciante_id INTEGER,
  tipo TEXT NOT NULL DEFAULT 'visualizacao',
  ip_origem TEXT,
  origem TEXT DEFAULT 'imobchat',
  user_agent TEXT,
  data TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_metricas_imovel ON metricas_cliques(imovel_id);
CREATE INDEX IF NOT EXISTS idx_metricas_data ON metricas_cliques(data);

-- 6) PAGAMENTOS — Mercado Pago
CREATE TABLE IF NOT EXISTS pagamentos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  anunciante_id INTEGER NOT NULL REFERENCES anunciantes(id),
  plano TEXT NOT NULL,
  valor REAL NOT NULL,
  mp_payment_id TEXT UNIQUE,
  mp_preapproval_id TEXT,
  status TEXT DEFAULT 'pending',
  metodo TEXT DEFAULT 'pix',
  criado_em TEXT DEFAULT (datetime('now')),
  atualizado_em TEXT DEFAULT (datetime('now'))
);

-- 7) CHAMADAS — registro
CREATE TABLE IF NOT EXISTS chamadas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  imovel_id INTEGER,
  anunciante_id INTEGER,
  tipo TEXT CHECK (tipo IN ('audio','video')),
  duracao_seg INTEGER DEFAULT 0,
  status TEXT DEFAULT 'iniciada',
  criado_em TEXT DEFAULT (datetime('now'))
);

-- 8) SALAS + SINALIZAÇÃO WebRTC (chamada nativa)
CREATE TABLE IF NOT EXISTS chamadas_salas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sala TEXT UNIQUE NOT NULL,
  imovel_id INTEGER,
  anunciante_id INTEGER,
  de_id TEXT DEFAULT 'visitante',
  de_nome TEXT DEFAULT '',
  tipo TEXT DEFAULT 'audio',
  status TEXT DEFAULT 'tocando',
  criado_em TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_salas_status ON chamadas_salas(status);

CREATE TABLE IF NOT EXISTS sinalizacao (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sala TEXT NOT NULL,
  de_id TEXT NOT NULL,
  tipo TEXT NOT NULL,
  dados TEXT NOT NULL,
  criado_em TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sinal_sala ON sinalizacao(sala, id);

-- ============================================
-- DADOS INICIAIS — só para o site não abrir vazio
-- Jean = admin, e-mail pagenegocio@gmail.com
-- ============================================
INSERT OR IGNORE INTO anunciantes (id, email, senha_hash, slug, nome, whatsapp, tipo, cidade, estado, plano, bio, foto_perfil, capa_url, palavras_chave_seo) VALUES
(1, 'pagenegocio@gmail.com', '', 'jean-aguiar', 'Jean Aguiar', '5511999990000', 'corretor', 'São Paulo', 'SP', 'free', 'Corretor em São Paulo. Atendimento rápido no WhatsApp, visita agendada em minutos.', 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&q=80', '', 'apartamento sao paulo, casa venda sp'),
(2, 'marina@exemplo.com.br', '', 'marina-duarte', 'Marina Duarte', '5511999991111', 'corretor', 'São Paulo', 'SP', 'ouro', 'Especialista em Vila Mariana e Moema. 10 anos de mercado, CRECI-SP.', 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200&q=80', 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=1200&q=80', 'apartamento vila mariana, imoveis moema'),
(3, 'carlos@exemplo.com.br', '', 'carlos-mendes', 'Carlos Mendes', '5511999992222', 'corretor', 'São Paulo', 'SP', 'prata', 'Casas e sobrados na Zona Leste. Financiamento facilitado.', 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=200&q=80', 'https://images.unsplash.com/photo-1568605114967-8130f3a36994?w=1200&q=80', 'casa zona leste sp');

INSERT OR IGNORE INTO imoveis (id, anunciante_id, titulo, preco, bairro, cidade, estado, tipo, area, quartos, banheiros, fotos_json) VALUES
(1, 1, 'Apto 2 quartos - Vila Prudente', 385000, 'Vila Prudente', 'São Paulo', 'SP', 'Apartamento', 58, 2, 1, '["https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=800&q=80"]'),
(2, 2, 'Apto Garden - Vila Mariana', 890000, 'Vila Mariana', 'São Paulo', 'SP', 'Apartamento', 92, 3, 2, '["https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=800&q=80"]'),
(3, 3, 'Casa 3 quartos - Mooca', 720000, 'Mooca', 'São Paulo', 'SP', 'Casa', 140, 3, 2, '["https://images.unsplash.com/photo-1568605114967-8130f3a36994?w=800&q=80"]');

INSERT OR IGNORE INTO chat_bot_regras (imovel_id, pergunta, resposta, ordem) VALUES
(1, 'Agendar visita', 'Perfeito! Temos visita hoje às 16h ou amanhã às 10h. Qual prefere? Toque em LIGAR ou VÍDEO no topo para falar comigo agora.', 1),
(1, 'Valor da entrada', 'Entrada a partir de R$ 38.500 (10%). Parcelamos o restante. Quer simulação?', 2),
(2, 'Agendar visita', 'Claro! Visita guiada por vídeo disponível agora. Toque em VÍDEO no topo.', 1),
(2, 'Condomínio incluso?', 'Condomínio R$ 680/mês, já com água e gás. IPTU R$ 210/mês.', 2);
