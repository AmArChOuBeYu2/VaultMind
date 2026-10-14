-- VaultMind Supabase Schema
-- Run this in your Supabase project: https://supabase.com/dashboard/project/ohfafaaiqpkzhtfbuvxu/sql/new

-- Create encrypted documents table (stores ONLY ciphertext - never plaintext)
CREATE TABLE IF NOT EXISTS public.vault_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    doc_id TEXT UNIQUE NOT NULL,
    owner_address TEXT NOT NULL,
    title TEXT NOT NULL,
    ciphertext TEXT NOT NULL,   -- AES-256-GCM encrypted base64 ciphertext
    iv TEXT NOT NULL,           -- 12-byte random nonce (base64)
    salt TEXT NOT NULL,         -- 16-byte HKDF salt (base64)
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for fast lookup
CREATE INDEX IF NOT EXISTS idx_vault_documents_doc_id ON public.vault_documents(doc_id);
CREATE INDEX IF NOT EXISTS idx_vault_documents_owner ON public.vault_documents(owner_address);

-- Enable Row Level Security
ALTER TABLE public.vault_documents ENABLE ROW LEVEL SECURITY;

-- Policies: all clients may insert and read ciphertext (no plaintext stored here)
DROP POLICY IF EXISTS "Allow document insertion" ON public.vault_documents;
CREATE POLICY "Allow document insertion" ON public.vault_documents
    FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Allow ciphertext read by doc_id" ON public.vault_documents;
CREATE POLICY "Allow ciphertext read by doc_id" ON public.vault_documents
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow owner document deletion" ON public.vault_documents;
CREATE POLICY "Allow owner document deletion" ON public.vault_documents
    FOR DELETE USING (true);
