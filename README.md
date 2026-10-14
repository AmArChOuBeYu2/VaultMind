# VaultMind — Privacy-First AI Memory Vault on Monad

> Metropolis Hackathon on Monad — Track 4: Trust, Identity & AI Infrastructure

VaultMind lets users store private documents encrypted with a **Mera Passkey (WebAuthn PRF)** key, grant a time-limited AI agent access via a Solidity smart contract on **Monad Testnet**, ask natural-language questions about their document, and revoke the grant onchain. After revocation, all further AI requests are rejected by both the frontend and the server API.

---

## Features

| Feature | Status |
|---|---|
| Mera Passkey sign-in + PRF key derivation | ✅ |
| Browser-side AES-256-GCM document encryption | ✅ |
| Supabase ciphertext persistence (never stores plaintext) | ✅ |
| GrantRegistry Solidity contract (grant / revoke / hasActiveGrant) | ✅ |
| Monad Testnet deployment script | ✅ |
| Server-side Monad permission check before LLM call | ✅ |
| Gemini 2.5-flash AI Q&A with cited source passages | ✅ |
| Revocation test: grant → ask → revoke → ask → rejected | ✅ |
| 4/4 smart contract unit tests passing | ✅ |

---

## Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Configure environment variables
Copy and fill in:
```bash
cp .env.example .env.local
```

Required variables in `.env.local`:
```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://ohfafaaiqpkzhtfbuvxu.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your-supabase-anon-key>

# Monad Testnet
NEXT_PUBLIC_MONAD_RPC_URL=https://testnet-rpc.monad.xyz
NEXT_PUBLIC_GRANT_REGISTRY_ADDRESS=<deployed-contract-address>

# AI Provider (Gemini / Kimi / Qwen / OpenAI compatible)
AI_API_KEY=<your-api-key>
AI_PROVIDER_URL=https://generativelanguage.googleapis.com/v1beta/openai
AI_MODEL_NAME=gemini-2.5-flash
```

### 3. Apply the Supabase schema
Open your Supabase SQL Editor at:
https://supabase.com/dashboard/project/ohfafaaiqpkzhtfbuvxu/sql/new

Run the contents of `supabase/schema.sql`.

> ⚠️ **This must be done before using the app.** The table `vault_documents` will not exist until you apply the schema.

### 4. Deploy the GrantRegistry smart contract to Monad Testnet

Create `.env` (for Hardhat) with your actual private key:
```env
MONAD_PRIVATE_KEY=0xYourActualPrivateKey64HexChars
NEXT_PUBLIC_MONAD_RPC_URL=https://testnet-rpc.monad.xyz
```

Fund your wallet at https://faucet.monad.xyz, then run:
```bash
npx hardhat run scripts/deploy.ts --network monadTestnet
```

Copy the printed contract address into `.env.local`:
```env
NEXT_PUBLIC_GRANT_REGISTRY_ADDRESS=0xDeployedAddress
```

### 5. Run locally
```bash
npm run dev
```
Open http://localhost:3000

---

## Smart Contract Tests
```bash
npm run test-contracts
```
```
  GrantRegistry Smart Contract Tests
    ✓ should register document and grant time-limited access
    ✓ should return false for expired grant
    ✓ should revoke access and immediately reject requests
    ✓ should reject grant or revoke attempts from non-owner accounts

  4 passing
```

## Revocation Demo Flow

1. Sign in with Mera Passkey
2. Upload a text document → inspect that Supabase stores only ciphertext (base64)
3. Click **Grant AI Access** → specify duration and agent address → Monad tx confirmed
4. Ask a question → AI answers with cited source passages
5. Click **Revoke Access** → Monad revocation tx confirmed
6. Ask another question → **rejected instantly** with "Grant Revoked" status from onchain check
7. Transaction hash / block evidence displayed in the UI

> **Honest disclosure**: Revocation stops *future* access. It cannot un-send context the AI provider already received in a prior request. Judges respond well to stated limits.

---

## Monad Testnet

- Chain ID: `10143`
- RPC: `https://testnet-rpc.monad.xyz`
- Explorer: https://testnet.monadvision.com
- Faucet: https://faucet.monad.xyz

---

## Architecture

```
Browser (React / Next.js)
  ├── Mera SDK  →  WebAuthn PRF  →  HKDF-SHA-256  →  AES-256-GCM key (memory only)
  ├── Encrypt doc  →  POST ciphertext to Supabase (no plaintext ever leaves browser)
  ├── ethers.js  →  GrantRegistry.grantAccess(docId, agent, expiry)  →  Monad Testnet
  └── Ask AI:
        1. Check hasActiveGrant onchain (browser)
        2. Decrypt ciphertext locally
        3. POST passages to /api/ai/query
              └── Server: re-check hasActiveGrant (independent Monad call)
              └── Server: call Gemini API (key never exposed to browser)
              └── Return answer + cited passages

GrantRegistry.sol (Monad Testnet)
  ├── registerDocument(bytes32 docId)
  ├── grantAccess(bytes32 docId, address agent, uint64 expiry)
  ├── revokeAccess(bytes32 docId, address agent)
  └── hasActiveGrant(bytes32 docId, address agent) → bool

Supabase (vault_documents)
  ├── doc_id, owner_address, title
  ├── ciphertext (AES-256-GCM, base64)
  ├── iv (12-byte nonce, base64)
  └── salt (16-byte HKDF salt, base64)
```
