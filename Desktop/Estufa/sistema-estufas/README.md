# 🌱 Sistema de Gestão de Estufas

Sistema web completo para gestão de estufas agrícolas com controle de produção, estoque, alertas de exame e cálculo automático de pagamentos por funcionário (com regra de ciclo de 12 meses, retenção e aumento dinâmico de preços).

---

## 📦 O que está incluído

| Arquivo | Descrição |
|---|---|
| `index.html` | Interface do sistema (login, dashboard, todas as telas) |
| `app.js` | Toda a lógica: regras de pagamento, estoque, alertas, importação Excel |
| `demo_data.json` | Dados pré-carregados extraídos da planilha de **maio/2026** (9 estufas, 19 funcionários, 277 bancadas, 323 lotes, 411.560 mudas) |
| `schema.sql` | Estrutura do banco para o Supabase (tabelas, RLS, roles) |
| `seed.sql` | Mesmos dados em SQL, prontos para subir no Supabase |

---

## ⚡ Modo 1 — Testar AGORA (sem instalar nada)

1. Abra o arquivo `index.html` no navegador (duplo clique).
2. Crie um usuário (o **primeiro cadastro vira admin** automaticamente).
3. Pronto. Os dados ficam salvos no navegador (`localStorage`).

> ⚠️ Modo demo funciona em **um só dispositivo / um só navegador**. Para múltiplos usuários e sincronização entre celular + computador, faça o deploy abaixo.

---

## 🌐 Modo 2 — Sistema online com login real (Supabase + Vercel)

### Passo 1 — Criar conta gratuita no Supabase

1. Vá em **https://supabase.com** → "Start your project" → entre com Google/GitHub.
2. Clique em **"New project"**.
3. Preencha:
   - **Name:** `estufas`
   - **Database Password:** anote em local seguro (você não usa direto)
   - **Region:** São Paulo
4. Aguarde ~2 minutos enquanto o banco é criado.

### Passo 2 — Criar as tabelas

1. No painel do Supabase, menu lateral: **SQL Editor → "New query"**.
2. Abra o arquivo `schema.sql`, copie TODO o conteúdo, cole no editor.
3. Clique em **"Run"**. Deve aparecer "Success".

### Passo 3 — Importar os dados de maio/2026

1. Mesmo SQL Editor → "New query".
2. Abra `seed.sql`, copie tudo, cole, **"Run"**.
3. Pronto: 9 estufas, 19 funcionários e 323 lotes carregados.

### Passo 4 — Pegar as credenciais

1. Menu lateral: **Project Settings → API**.
2. Copie:
   - **Project URL** (ex: `https://abcdef.supabase.co`)
   - **anon public key** (string que começa com `eyJ...`) qemirahvbogjdsvovpsn

### Passo 5 — Subir o site no Vercel (grátis)

1. Vá em **https://vercel.com** → entre com GitHub/Google.
2. Clique em **"Add New → Project"**.
3. Você tem 2 opções:
   - **A) Drag & drop:** arraste a pasta `sistema-estufas` inteira.
   - **B) Pelo GitHub:** suba a pasta para um repo e conecte.
4. Clique **"Deploy"**. Em ~30s seu site estará no ar.
5. URL final: algo como `https://estufas.vercel.app`.

### Passo 6 — Conectar o site ao Supabase

1. Abra a URL do seu site no celular ou navegador.
2. Na tela de login, clique **"⚙️ Configurar Supabase (online)"**.
3. Cole a **Project URL** e a **anon key**.
4. Clique **"Salvar e usar online"**.
5. Volte para o login e clique em **"Criar conta"** com seu e-mail.

### Passo 7 — Virar admin

1. No Supabase, **SQL Editor → "New query"**, rode:
   ```sql
   UPDATE public.user_profiles
   SET role='admin'
   WHERE email='SEU_EMAIL_AQUI@gmail.com';
   ```
2. Faça logout e login de novo. Agora você tem permissão de editar.
3. Para o segundo admin: depois que ele criar a conta, repita o UPDATE com o e-mail dele.
4. Funcionários que só vão visualizar: **não precisam** de UPDATE — já entram como `viewer`.

---

## 💰 Como funcionam as regras de pagamento (já implementadas)

### Valores por sítio
- **São José:** `(1,30 - 0,15) / 12 × quantidade` por mês
- **Bela Vista / Santo Antônio:** `(1,35 - 0,15) / 12 × quantidade` por mês

### Ciclo de 12 meses
- **Mês 1 a 11:** parcela mensal proporcional
- **Mês 12:** parcela mensal + retenção final (`0,15 × qtd`)
- **Mês 13:** ainda permite pagar a retenção se atrasou
- **Mês 14+:** ❌ não recebe mais nada (qualidade comprometida)

### Aumento de preço dinâmico
Vá em **💵 Preços → "+ Novo preço"** e cadastre um novo valor com a **data de vigência**.
Exemplo: aumento a partir de **01/03/2026** → mudas plantadas em fevereiro mantêm o preço antigo, plantadas em março passam a usar o novo.

### Tipos de muda
- **Muda normal** (1 enxerto)
- **Inter-enxerto** (2 enxertos) — campo `tipo` no cadastro de lote.

### Alerta de exame
Cadastre **"Data do enxerto"** ao criar/editar o lote. Após **50 dias**, ele aparece automaticamente no Dashboard e na tela **⏰ Alertas Exame** com a estufa e bancada.

---

## 🖨️ Imprimindo folhas de pagamento

1. Menu **💰 Pagamentos**.
2. Selecione o mês.
3. Para imprimir TUDO: botão **🖨️ Imprimir tudo** (uma página com todos os funcionários).
4. Para imprimir UM funcionário com detalhamento por bancada (qtd, porta-enxerto, variedade, plantio, parcela, valor): clique em **"Detalhar / Imprimir"** na linha → botão **🖨️ Imprimir**.
5. A folha individual já vem formatada com cabeçalho, subtotais por estufa, total geral e linhas para assinatura do funcionário e responsável.

---

## 📤 Importando novas planilhas

Menu **📤 Importar Excel**:
1. Selecione `.xlsx`, `.xls` ou `.ods` (mesmo formato GEDAVE).
2. Escolha a aba.
3. Mapeie as colunas (o sistema tenta adivinhar).
4. Escolha a estufa de destino.
5. Clique "Importar lotes".

Se o nome do funcionário aparecer na planilha e ainda não existir, ele é cadastrado automaticamente.

---

## 🔧 Suporte rápido

| Sintoma | Solução |
|---|---|
| Site abriu mas não tem dados | Ainda no modo demo. Configure o Supabase nos passos 4-6. |
| "Apenas administradores podem editar" | Você é viewer. Rode o UPDATE do passo 7. |
| Esqueci a senha | Supabase → Authentication → Users → … → "Reset password" |
| Quero zerar dados demo | F12 do navegador → Console → `localStorage.clear()` → F5 |

---

## 📁 Estrutura para deploy

Faça upload destes 3 arquivos na raiz do Vercel/Netlify:

```
index.html
app.js
demo_data.json   ← opcional, só usado no modo demo
```

Pronto. Sem build, sem npm, sem Node. É só HTML + JS puro.
