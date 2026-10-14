import { createClient } from "@supabase/supabase-js";
import { EncryptedPayload } from "./crypto";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

export const isSupabaseConfigured = Boolean(
  supabaseUrl && 
  supabaseAnonKey && 
  !supabaseUrl.includes("your-supabase-project")
);

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

export interface VaultDocumentRecord {
  id?: string;
  doc_id: string;
  owner_address: string;
  title: string;
  ciphertext: string;
  iv: string;
  salt: string;
  created_at?: string;
}

// In-memory / localStorage fallback cache for testing when Supabase env is not configured
const LOCAL_STORAGE_KEY = "vaultmind_encrypted_documents_cache";

function getLocalDocuments(): VaultDocumentRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveLocalDocument(doc: VaultDocumentRecord) {
  if (typeof window === "undefined") return;
  const docs = getLocalDocuments();
  const index = docs.findIndex((d) => d.doc_id === doc.doc_id);
  if (index >= 0) {
    docs[index] = doc;
  } else {
    docs.push(doc);
  }
  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(docs));
}

/**
 * Save encrypted ciphertext document to Supabase (or fallback storage)
 */
export async function saveEncryptedDocument(
  docId: string,
  ownerAddress: string,
  title: string,
  payload: EncryptedPayload
): Promise<VaultDocumentRecord> {
  const record: VaultDocumentRecord = {
    doc_id: docId,
    owner_address: ownerAddress.toLowerCase(),
    title: title,
    ciphertext: payload.ciphertext,
    iv: payload.iv,
    salt: payload.salt,
    created_at: new Date().toISOString(),
  };

  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase
      .from("vault_documents")
      .upsert([record], { onConflict: "doc_id" })
      .select()
      .single();

    if (error) {
      console.warn("Supabase upsert notice:", error.message);
      saveLocalDocument(record);
      return record;
    }
    return data as VaultDocumentRecord;
  }

  // Fallback
  saveLocalDocument(record);
  return record;
}

/**
 * Fetch ciphertext payload by docId
 */
export async function getEncryptedDocument(
  docId: string
): Promise<VaultDocumentRecord | null> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase
      .from("vault_documents")
      .select("*")
      .eq("doc_id", docId)
      .maybeSingle();

    if (!error && data) {
      return data as VaultDocumentRecord;
    }
  }

  // Fallback
  const docs = getLocalDocuments();
  return docs.find((d) => d.doc_id === docId) || null;
}

/**
 * Fetch all documents owned by user address
 */
export async function listUserDocuments(
  ownerAddress: string
): Promise<VaultDocumentRecord[]> {
  const normAddress = ownerAddress.toLowerCase();
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase
      .from("vault_documents")
      .select("*")
      .ilike("owner_address", normAddress)
      .order("created_at", { ascending: false });

    if (!error && data) {
      return data as VaultDocumentRecord[];
    }
  }

  // Fallback
  const docs = getLocalDocuments();
  return docs.filter((d) => d.owner_address.toLowerCase() === normAddress);
}
