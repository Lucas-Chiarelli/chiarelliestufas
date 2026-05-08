-- ============================================================
-- SISTEMA DE GESTAO DE ESTUFAS - SCHEMA SUPABASE (v2)
-- Rode este arquivo INTEIRO em: Supabase -> SQL Editor -> Run
-- DEPOIS rode o seed.sql
-- ============================================================

DROP TABLE IF EXISTS public.estoque_movimentos CASCADE;
DROP TABLE IF EXISTS public.alertas_exame CASCADE;
DROP TABLE IF EXISTS public.parcelas_pagas CASCADE;
DROP TABLE IF EXISTS public.lotes CASCADE;
DROP TABLE IF EXISTS public.bancadas CASCADE;
DROP TABLE IF EXISTS public.funcionarios CASCADE;
DROP TABLE IF EXISTS public.estufas CASCADE;
DROP TABLE IF EXISTS public.precos_sitio CASCADE;
DROP TABLE IF EXISTS public.clientes CASCADE;
DROP TABLE IF EXISTS public.user_profiles CASCADE;

-- Perfis
CREATE TABLE public.user_profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  nome text,
  role text NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin','viewer')),
  funcionario_id uuid,
  created_at timestamptz DEFAULT now()
);

-- Funcionarios (com tipo de pagamento e salario fixo opcional)
CREATE TABLE public.funcionarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL UNIQUE,
  tipo text NOT NULL DEFAULT 'por_muda' CHECK (tipo IN ('por_muda','salario_fixo')),
  salario_fixo numeric(10,2),
  ativo boolean DEFAULT true,
  observacao text,
  created_at timestamptz DEFAULT now()
);

-- Estufas (com array de funcionarios padrao)
CREATE TABLE public.estufas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  sitio text NOT NULL CHECK (sitio IN ('sao_jose','bela_vista','santo_antonio')),
  num_bancadas integer DEFAULT 24,
  funcionarios_padrao uuid[] DEFAULT '{}',
  ativo boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Bancadas
CREATE TABLE public.bancadas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  estufa_id uuid NOT NULL REFERENCES public.estufas(id) ON DELETE CASCADE,
  numero text NOT NULL,
  funcionario_id uuid REFERENCES public.funcionarios(id) ON DELETE SET NULL,
  observacao text,
  UNIQUE(estufa_id, numero)
);

-- Tabela de precos por sitio
CREATE TABLE public.precos_sitio (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sitio text NOT NULL CHECK (sitio IN ('sao_jose','bela_vista','santo_antonio')),
  valor_total numeric(10,4) NOT NULL,
  valor_final numeric(10,4) NOT NULL DEFAULT 0.15,
  vigencia_inicio date NOT NULL,
  observacao text,
  created_at timestamptz DEFAULT now()
);

-- Lotes
CREATE TABLE public.lotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bancada_id uuid NOT NULL REFERENCES public.bancadas(id) ON DELETE CASCADE,
  funcionario_id uuid REFERENCES public.funcionarios(id) ON DELETE SET NULL,
  qtd integer NOT NULL CHECK (qtd > 0),
  porta_enxerto text,
  variedade text,
  tipo text NOT NULL DEFAULT 'muda_normal' CHECK (tipo IN ('muda_normal','inter_enxerto')),
  data_plantio date NOT NULL,
  data_enxerto date,
  observacao text,
  created_at timestamptz DEFAULT now()
);

-- Clientes
CREATE TABLE public.clientes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  cnpj_cpf text,
  contato text,
  created_at timestamptz DEFAULT now()
);

-- Movimentos de estoque
CREATE TABLE public.estoque_movimentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lote_id uuid NOT NULL REFERENCES public.lotes(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('entrada','saida_total','saida_parcial')),
  qtd integer NOT NULL,
  cliente_id uuid REFERENCES public.clientes(id) ON DELETE SET NULL,
  data date NOT NULL DEFAULT CURRENT_DATE,
  observacao text,
  created_at timestamptz DEFAULT now()
);

-- Parcelas pagas
CREATE TABLE public.parcelas_pagas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lote_id uuid NOT NULL REFERENCES public.lotes(id) ON DELETE CASCADE,
  funcionario_id uuid REFERENCES public.funcionarios(id) ON DELETE SET NULL,
  ano integer NOT NULL,
  mes integer NOT NULL CHECK (mes BETWEEN 1 AND 12),
  parcela_num integer,
  valor numeric(10,2) NOT NULL,
  paga boolean DEFAULT true,
  data_pagamento date DEFAULT CURRENT_DATE,
  observacao text,
  UNIQUE(lote_id, ano, mes)
);

-- Alertas de exame
CREATE TABLE public.alertas_exame (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lote_id uuid NOT NULL REFERENCES public.lotes(id) ON DELETE CASCADE,
  data_alerta date NOT NULL,
  status text DEFAULT 'pendente' CHECK (status IN ('pendente','enviado','dispensado')),
  observacao text,
  created_at timestamptz DEFAULT now()
);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estufas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.funcionarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bancadas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.precos_sitio ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estoque_movimentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parcelas_pagas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alertas_exame ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean LANGUAGE sql SECURITY DEFINER AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role = 'admin');
$$;

DO $$ DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY['estufas','funcionarios','bancadas','lotes','precos_sitio','clientes','estoque_movimentos','parcelas_pagas','alertas_exame'])
  LOOP
    EXECUTE format('CREATE POLICY "auth_select_%I" ON public.%I FOR SELECT TO authenticated USING (true);', t, t);
    EXECUTE format('CREATE POLICY "admin_insert_%I" ON public.%I FOR INSERT TO authenticated WITH CHECK (public.is_admin());', t, t);
    EXECUTE format('CREATE POLICY "admin_update_%I" ON public.%I FOR UPDATE TO authenticated USING (public.is_admin());', t, t);
    EXECUTE format('CREATE POLICY "admin_delete_%I" ON public.%I FOR DELETE TO authenticated USING (public.is_admin());', t, t);
  END LOOP;
END $$;

CREATE POLICY "self_or_admin_select" ON public.user_profiles FOR SELECT TO authenticated USING (id = auth.uid() OR public.is_admin());
CREATE POLICY "self_insert" ON public.user_profiles FOR INSERT TO authenticated WITH CHECK (id = auth.uid());
CREATE POLICY "admin_update_profiles" ON public.user_profiles FOR UPDATE TO authenticated USING (public.is_admin());

-- Cria perfil ao registrar
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.user_profiles (id, email, nome, role)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'nome', NEW.email), 'viewer');
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
