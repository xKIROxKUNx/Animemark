# Configuração do AnimeMark

Passo a passo para deixar o app no ar. Leva uns 15 minutos e só precisa ser
feito uma vez.

---

## 1. Criar o projeto no Firebase

1. Abra <https://console.firebase.google.com> e clique em **Adicionar projeto**.
   Pode chamar de `animemark`. O Google Analytics é dispensável.
2. Dentro do projeto, em **Criação → Firestore Database**, clique em **Criar
   banco de dados**. Escolha a região `southamerica-east1` (São Paulo) e comece
   em **modo de produção** — as regras deste repositório serão aplicadas no
   passo 4 e substituem as padrão.
3. Em **Criação → Authentication → Sign-in method**, ative **E-mail/senha**.
   Deixe "Link de e-mail" **desativado**.

## 2. Registrar o app web e copiar a configuração

1. Na engrenagem ⚙️ → **Configurações do projeto** → role até **Seus apps** →
   ícone `</>` (Web). Chame de `AnimeMark`. **Não** marque Firebase Hosting.
2. Copie o objeto `firebaseConfig` que aparece e cole em
   [`src/firebase-config.js`](src/firebase-config.js), substituindo os
   `COLE_AQUI_...`.

> Esses valores **não são segredo**. Todo PWA precisa deles no bundle e qualquer
> pessoa consegue lê-los abrindo o site. Quem protege a lista são as regras do
> passo 4, que exigem um documento de ativação com o e-mail conferindo.

3. Ainda em **Authentication → Settings → Domínios autorizados**, adicione
   `xkiroxkunx.github.io`. Sem isso o login falha no site publicado.

## 3. Criar as duas contas

Não existe cadastro dentro do app — de propósito. As contas nascem no console:

1. **Authentication → Users → Adicionar usuário**.
2. Informe o e-mail e uma senha. Repita para a segunda pessoa.
3. **Copie o UID** de cada uma (a coluna "Identificador do usuário").

## Atalho: provisionar tudo por script

Os passos 2, 3 e 4 podem ser feitos de uma vez. No console, em
**Configurações do projeto → Contas de serviço → Gerar nova chave privada**,
baixe o JSON e rode:

```bash
node scripts/provisionar.mjs --chave ~/Downloads/chave.json \
  --conta voce@exemplo.com:senhaInicial \
  --conta amiga@exemplo.com:outraSenha
```

Ele liga o login por e-mail/senha, autoriza o domínio do GitHub Pages, registra
o app web e grava `src/firebase-config.js`, cria as contas e os documentos de
ativação, e publica as regras. Rodar de novo não estraga nada.

Duas coisas o script **não** consegue fazer, porque a chave padrão do Admin SDK
não tem permissão de `serviceusage` — e ele diz isso na saída se faltarem:

- **criar o banco do Firestore** (passo 1.2 abaixo) — é o que ativa a API;
- **inicializar o Authentication** (passo 1.3) — um clique em "Comece agora".

Faça esses dois no console antes de rodar o script. Depois sobra só ligar o
GitHub Pages (passo 5).

> A chave de service account é uma credencial de verdade. Apague o arquivo e a
> chave no console assim que terminar.

Se preferir fazer à mão, siga os passos 2 a 4 abaixo.

## 4. Ativar as contas e aplicar as regras

### Ativação (é o que libera o acesso)

Para cada pessoa, em **Firestore Database → Iniciar coleção**:

- Coleção: `members`
- ID do documento: **o UID copiado no passo 3**
- Campos:
  - `email` (string) → exatamente o mesmo e-mail da conta
  - `nickname` (string) → deixe vazio; a pessoa escolhe no primeiro login

Se o documento não existir, ou se o `email` não bater com o da conta, a pessoa
consegue entrar mas vê a tela **"Conta não autorizada"** e não lê nem escreve
nada. É esse o mecanismo de ativação.

### Regras e índices

```bash
npm install
npx firebase login          # abre o navegador
npx firebase use --add      # escolha o projeto criado no passo 1
npx firebase deploy --only firestore:rules
```

Não há índice composto para criar: a lista usa um único `orderBy('order')`, com
o grupo (a assistir / assistido) embutido no primeiro caractere da chave. O
Firestore atende isso com o índice automático de campo simples.

## 5. Publicar no GitHub Pages

1. No repositório: **Settings → Pages → Build and deployment → Source:
   GitHub Actions**.
2. Faça merge na branch `main`. O workflow
   [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) builda e
   publica sozinho.
3. O app fica em <https://xkiroxkunx.github.io/Animemark/>.

## 6. Instalar no celular

- **Android (Chrome)**: menu ⋮ → *Instalar app*.
- **iPhone (Safari)**: botão compartilhar → *Adicionar à Tela de Início*.

---

## Desenvolvimento local

```bash
npm install
npm run dev        # http://localhost:5173/Animemark/
```

Para rodar contra os emuladores em vez do projeto real:

```bash
npm run emulators                       # terminal 1
npm run test:rules                      # terminal 2 — regras de segurança
VITE_USE_EMULATORS=true npm run build   # terminal 2 — build apontado ao emulador
npm run test:e2e                        # terminal 2 — smoke test do app inteiro
```

Os ícones são gerados a partir de `public/icons/favicon.svg`:

```bash
node scripts/gerar-icones.mjs
```

## Resolução de problemas

| Sintoma | Causa provável |
|---|---|
| "Conta não autorizada" | Falta o doc `members/{uid}` ou o `email` não bate |
| `auth/operation-not-allowed` | E-mail/senha não foi ativado no passo 1.3 |
| `auth/unauthorized-domain` | Falta adicionar `xkiroxkunx.github.io` no passo 2.3 |
| Campo do IMDb em branco | O Wikidata não mapeia esse anime — preencha à mão no modal |
