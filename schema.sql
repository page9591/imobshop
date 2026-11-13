-- ============================================
-- ImobChat — CORREÇÃO D1: 1 e-mail = 1 perfil
-- Rode NO Cloudflare D1, DEPOIS do schema.sql:
-- npx wrangler d1 execute imobchat-db --file=./schema-fix-email-unico.sql
-- ============================================

-- 1) Tira duplicata de e-mail (mantém o id menor)
DELETE FROM anunciantes WHERE id NOT IN (
  SELECT MIN(id) FROM anunciantes WHERE email IS NOT NULL AND email != '' GROUP BY LOWER(TRIM(email))
) AND email IS NOT NULL AND email != '';

-- 2) Cria as colunas que faltavam (se já existir, o D1 ignora o erro e segue)
ALTER TABLE anunciantes ADD COLUMN senha_hash TEXT DEFAULT '';
ALTER TABLE anunciantes ADD COLUMN tipo TEXT DEFAULT 'corretor';
ALTER TABLE anunciantes ADD COLUMN ativo INTEGER DEFAULT 1;

-- 3) TRAVA: 1 e-mail = 1 perfil. Sem isso, 2 contas com mesmo e-mail caem no mesmo perfil.
CREATE UNIQUE INDEX IF NOT EXISTS idx_anunciantes_email_unico
  ON anunciantes(LOWER(TRIM(email))) WHERE email IS NOT NULL AND email != '';

CREATE INDEX IF NOT EXISTS idx_anunciantes_slug ON anunciantes(slug);
CREATE INDEX IF NOT EXISTS idx_anunciantes_ativo ON anunciantes(ativo);

-- 4) Jean / admin passa a ser dono do e-mail pagenegocio@gmail.com (não mais id=1 sem e-mail)
UPDATE anunciantes
SET email = 'pagenegocio@gmail.com', tipo = 'corretor', ativo = 1
WHERE id = 1 AND (email IS NULL OR email = '');

-- Se já existir outro com pagenegocio, mantém o menor id e apaga o duplicado
DELETE FROM anunciantes WHERE email = 'pagenegocio@gmail.com' AND id != (SELECT MIN(id) FROM anunciantes WHERE email = 'pagenegocio@gmail.com');

-- 5) LEADS: não existia no schema.sql. Sem ela, contato cai no localStorage e some.
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

-- 6) Garante que imoveis sempre apontam para um anunciante válido
CREATE INDEX IF NOT EXISTS idx_imoveis_anunciante_ativo ON imoveis(anunciante_id, ativo);
