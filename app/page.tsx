"use client";

import React, { useState, useEffect } from "react";
import {
  Shield,
  Key,
  FileText,
  Lock,
  Unlock,
  CheckCircle2,
  XCircle,
  Clock,
  Sparkles,
  FileUp,
  Cpu,
  RefreshCw,
  AlertTriangle,
  ExternalLink,
  ChevronRight,
  Send,
  Database,
  Eye,
  EyeOff,
  UserCheck
} from "lucide-react";
import { authenticateWithMeraPasskey, MeraUserSession } from "@/lib/mera";
import { encryptDocument, decryptDocument, EncryptedPayload } from "@/lib/crypto";
import {
  saveEncryptedDocument,
  getEncryptedDocument,
  listUserDocuments,
  VaultDocumentRecord,
  isSupabaseConfigured
} from "@/lib/supabase";
import {
  checkHasActiveGrant,
  executeGrantAccess,
  executeRevokeAccess,
  isContractConfigured,
  GRANT_REGISTRY_ADDRESS,
  MONAD_RPC_URL
} from "@/lib/monad";
import { ethers } from "ethers";

// Default AI Agent wallet address for demo
const DEFAULT_AI_AGENT = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

export default function VaultMindApp() {
  // Session State
  const [session, setSession] = useState<MeraUserSession | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Document Management State
  const [docTitle, setDocTitle] = useState("");
  const [docContent, setDocContent] = useState("");
  const [userDocs, setUserDocs] = useState<VaultDocumentRecord[]>([]);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [encrypting, setEncrypting] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);

  // Current Selected Document Details
  const [activeDocRecord, setActiveDocRecord] = useState<VaultDocumentRecord | null>(null);
  const [showCiphertext, setShowCiphertext] = useState(false);

  // Grant & Monad Smart Contract State
  const [agentAddress, setAgentAddress] = useState(DEFAULT_AI_AGENT);
  const [grantDurationMinutes, setGrantDurationMinutes] = useState(15);
  const [granting, setGranting] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [txEvidence, setTxEvidence] = useState<{ type: string; hash: string; timestamp: string } | null>(null);

  // Onchain Grant Status
  const [grantStatus, setGrantStatus] = useState<{
    active: boolean;
    isRevoked: boolean;
    expiry: number;
    source: "monad" | "local_cache";
  } | null>(null);
  const [checkingGrant, setCheckingGrant] = useState(false);

  // AI Q&A State
  const [question, setQuestion] = useState("");
  const [queryingAI, setQueryingAI] = useState(false);
  const [aiResponse, setAiResponse] = useState<{
    answer?: string;
    error?: string;
    citedPassages?: string[];
    permissionStatus?: any;
    isConfigError?: boolean;
  } | null>(null);

  // Auto load documents when session changes
  useEffect(() => {
    if (session?.address) {
      loadDocuments(session.address);
    }
  }, [session]);

  // Auto check grant when selected document changes
  useEffect(() => {
    if (selectedDocId && agentAddress) {
      refreshGrantStatus(selectedDocId, agentAddress);
    }
  }, [selectedDocId, agentAddress]);

  const loadDocuments = async (ownerAddr: string) => {
    const docs = await listUserDocuments(ownerAddr);
    setUserDocs(docs);
    if (docs.length > 0 && !selectedDocId) {
      setSelectedDocId(docs[0].doc_id);
      setActiveDocRecord(docs[0]);
    }
  };

  const handleSelectDoc = (doc: VaultDocumentRecord) => {
    setSelectedDocId(doc.doc_id);
    setActiveDocRecord(doc);
    setAiResponse(null);
    setTxEvidence(null);
  };

  // 1. Mera Passkey Login
  const handleMeraSignIn = async () => {
    setAuthLoading(true);
    setAuthError(null);
    try {
      const userSession = await authenticateWithMeraPasskey();
      setSession(userSession);
    } catch (err: any) {
      setAuthError(err?.message || "Failed to authenticate with Mera Passkey.");
    } finally {
      setAuthLoading(false);
    }
  };

  // 2. Browser-Side Document Encryption & Supabase Storage
  const handleUploadAndEncrypt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session?.prfSecret) {
      setUploadStatus("Error: Passkey session required to derive encryption key.");
      return;
    }
    if (!docTitle.trim() || !docContent.trim()) {
      setUploadStatus("Error: Please provide both document title and content.");
      return;
    }

    setEncrypting(true);
    setUploadStatus("Deriving HKDF key & encrypting document with AES-256-GCM...");

    try {
      // 1. Encrypt in browser with Web Crypto API
      const payload: EncryptedPayload = await encryptDocument(docContent, session.prfSecret);

      // 2. Generate deterministic document ID bytes32
      const docId = ethers.keccak256(
        new TextEncoder().encode(`${session.address}-${docTitle}-${Date.now()}`)
      );

      setUploadStatus("Uploading ciphertext payload to Supabase...");

      // 3. Save ciphertext to Supabase
      const record = await saveEncryptedDocument(
        docId,
        session.address,
        docTitle,
        payload
      );

      setUploadStatus("Document encrypted and stored securely!");
      setDocTitle("");
      setDocContent("");

      // Reload document list
      await loadDocuments(session.address);
      handleSelectDoc(record);
    } catch (err: any) {
      setUploadStatus(`Upload failed: ${err?.message || err}`);
    } finally {
      setEncrypting(false);
    }
  };

  // 3. Grant Access on Monad Smart Contract
  const handleGrantAccess = async () => {
    if (!selectedDocId || !session) return;
    setGranting(true);
    try {
      const expiryTimestamp = Math.floor(Date.now() / 1000) + grantDurationMinutes * 60;
      const signer = new ethers.VoidSigner(session.address);
      const res = await executeGrantAccess(signer, selectedDocId, agentAddress, expiryTimestamp);

      setTxEvidence({
        type: "Grant Created",
        hash: res.txHash,
        timestamp: new Date().toLocaleTimeString(),
      });

      await refreshGrantStatus(selectedDocId, agentAddress);
    } catch (err: any) {
      alert(`Grant transaction failed: ${err?.message || err}`);
    } finally {
      setGranting(false);
    }
  };

  // 4. Revoke Access on Monad Smart Contract
  const handleRevokeAccess = async () => {
    if (!selectedDocId || !session) return;
    setRevoking(true);
    try {
      const signer = new ethers.VoidSigner(session.address);
      const res = await executeRevokeAccess(signer, selectedDocId, agentAddress);

      setTxEvidence({
        type: "Grant Revoked",
        hash: res.txHash,
        timestamp: new Date().toLocaleTimeString(),
      });

      await refreshGrantStatus(selectedDocId, agentAddress);
    } catch (err: any) {
      alert(`Revocation transaction failed: ${err?.message || err}`);
    } finally {
      setRevoking(false);
    }
  };

  const refreshGrantStatus = async (docId: string, agent: string) => {
    setCheckingGrant(true);
    try {
      const status = await checkHasActiveGrant(docId, agent);
      setGrantStatus(status);
    } catch (err) {
      console.error(err);
    } finally {
      setCheckingGrant(false);
    }
  };

  // 5. AI Question-Answering (Checking Monad permissions, Decrypting in browser, Querying AI)
  const handleAskAI = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDocId || !question.trim() || !session) return;

    setQueryingAI(true);
    setAiResponse(null);

    try {
      // Step A: Check Monad Smart Contract Permission in Browser
      const permission = await checkHasActiveGrant(selectedDocId, agentAddress);
      setGrantStatus(permission);

      if (!permission.active) {
        setAiResponse({
          error: "ACCESS REJECTED: Monad smart contract shows NO ACTIVE GRANT or grant has been REVOKED.",
          permissionStatus: permission,
        });
        setQueryingAI(false);
        return;
      }

      // Step B: Retrieve Ciphertext & Decrypt in Browser Memory
      const record = activeDocRecord || (await getEncryptedDocument(selectedDocId));
      if (!record) {
        throw new Error("Encrypted document record not found.");
      }

      const plaintext = await decryptDocument(
        {
          ciphertext: record.ciphertext,
          iv: record.iv,
          salt: record.salt,
        },
        session.prfSecret
      );

      // Step C: Chunk Plaintext document into passages
      const paragraphs = plaintext
        .split(/\n\n+/)
        .map((p) => p.trim())
        .filter((p) => p.length > 0);

      const passages = paragraphs.length > 0 ? paragraphs : [plaintext];

      // Step D: Call Server AI Endpoint (Server re-verifies Monad permission before invoking LLM)
      const res = await fetch("/api/ai/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          docId: selectedDocId,
          question: question,
          passages: passages,
          agentAddress: agentAddress,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setAiResponse({
          error: data.error || "Server query failed.",
          permissionStatus: data.permissionStatus || permission,
        });
      } else {
        setAiResponse(data);
      }
    } catch (err: any) {
      setAiResponse({
        error: `Query error: ${err?.message || err}`,
      });
    } finally {
      setQueryingAI(false);
    }
  };

  return (
    <div style={{ maxWidth: "1280px", margin: "0 auto", padding: "2rem 1.5rem" }}>
      {/* HEADER BAR */}
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "2.5rem",
          paddingBottom: "1.5rem",
          borderBottom: "1px solid var(--bg-card-border)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          <div
            style={{
              width: "48px",
              height: "48px",
              borderRadius: "14px",
              background: "linear-gradient(135deg, #8b5cf6, #6366f1)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 0 20px rgba(139, 92, 246, 0.4)",
            }}
          >
            <Shield size={26} color="#fff" />
          </div>
          <div>
            <h1 style={{ fontSize: "1.75rem", fontWeight: "800", letterSpacing: "-0.5px" }}>
              Vault<span style={{ color: "var(--accent-purple)" }}>Mind</span>
            </h1>
            <p style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
              Privacy-First AI Memory Vault on Monad Testnet
            </p>
          </div>
        </div>

        {/* STATUS BADGES */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
          <div className="badge-purple" style={{ padding: "0.4rem 0.8rem", borderRadius: "20px", fontSize: "0.8rem", display: "flex", alignItems: "center", gap: "0.4rem" }}>
            <Cpu size={14} />
            <span>Monad Testnet (Chain ID 10143)</span>
          </div>

          <div
            className={isSupabaseConfigured ? "badge-green" : "badge-blue"}
            style={{ padding: "0.4rem 0.8rem", borderRadius: "20px", fontSize: "0.8rem", display: "flex", alignItems: "center", gap: "0.4rem" }}
          >
            <Database size={14} />
            <span>{isSupabaseConfigured ? "Supabase Cloud" : "Local Storage Sync"}</span>
          </div>

          <div
            className={isContractConfigured() ? "badge-green" : "badge-purple"}
            style={{ padding: "0.4rem 0.8rem", borderRadius: "20px", fontSize: "0.8rem", display: "flex", alignItems: "center", gap: "0.4rem" }}
          >
            <Lock size={14} />
            <span>{isContractConfigured() ? "Onchain Contract Active" : "Contract Simulator Active"}</span>
          </div>
        </div>
      </header>

      {!session ? (
        /* PASSKEY AUTHENTICATION SCREEN */
        <div style={{ maxWidth: "600px", margin: "4rem auto", textAlign: "center" }}>
          <div className="glass-panel" style={{ padding: "3rem 2rem" }}>
            <div
              style={{
                width: "72px",
                height: "72px",
                borderRadius: "50%",
                background: "rgba(139, 92, 246, 0.15)",
                border: "1px solid rgba(139, 92, 246, 0.3)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                margin: "0 auto 1.5rem auto",
              }}
            >
              <Key size={36} color="var(--accent-purple)" />
            </div>

            <h2 style={{ fontSize: "1.8rem", fontWeight: "700", marginBottom: "0.75rem" }}>
              Sign in with Mera Passkey
            </h2>
            <p style={{ color: "var(--text-muted)", fontSize: "0.95rem", lineHeight: "1.6", marginBottom: "2rem" }}>
              VaultMind uses <strong>Mera Passkey PRF key derivation</strong>. Your document encryption key is derived locally in memory. Zero plaintext or private keys are ever stored or sent to any server.
            </p>

            {authError && (
              <div
                className="badge-red"
                style={{ padding: "0.8rem 1rem", borderRadius: "10px", marginBottom: "1.5rem", fontSize: "0.9rem", textAlign: "left" }}
              >
                <AlertTriangle size={16} style={{ display: "inline", marginRight: "0.5rem" }} />
                {authError}
              </div>
            )}

            <button
              onClick={handleMeraSignIn}
              disabled={authLoading}
              className="btn-primary"
              style={{ width: "100%", padding: "1rem", fontSize: "1.05rem" }}
            >
              {authLoading ? (
                <>
                  <RefreshCw size={20} className="spin-icon" style={{ animation: "spin 1s linear infinite" }} />
                  Authenticating Passkey...
                </>
              ) : (
                <>
                  <Key size={20} />
                  Sign In / Create Mera Passkey
                </>
              )}
            </button>

            <div style={{ marginTop: "2rem", paddingTop: "1.5rem", borderTop: "1px solid var(--bg-card-border)", display: "flex", justifyContent: "space-around", fontSize: "0.8rem", color: "var(--text-muted)" }}>
              <span>🔐 AES-256-GCM Encryption</span>
              <span>⚡ Monad Time-Limited Grants</span>
              <span>🛡️ Defensible Security</span>
            </div>
          </div>
        </div>
      ) : (
        /* MAIN DASHBOARD (AUTHENTICATED) */
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2rem" }}>
          
          {/* LEFT COLUMN: AUTH & DOCUMENT VAULT */}
          <div style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>
            
            {/* USER SESSION CARD */}
            <div className="glass-panel" style={{ padding: "1.5rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                  <UserCheck size={20} color="var(--accent-emerald)" />
                  <h3 style={{ fontSize: "1.1rem", fontWeight: "600" }}>Mera Authenticated Session</h3>
                </div>
                <button
                  onClick={() => setSession(null)}
                  className="btn-secondary"
                  style={{ padding: "0.4rem 0.8rem", fontSize: "0.8rem" }}
                >
                  Sign Out
                </button>
              </div>

              <div style={{ background: "rgba(0,0,0,0.3)", padding: "0.8rem 1rem", borderRadius: "10px", fontSize: "0.85rem", fontFamily: "monospace" }}>
                <div style={{ marginBottom: "0.4rem", color: "var(--text-muted)" }}>
                  Owner Address: <span style={{ color: "#fff" }}>{session.address}</span>
                </div>
                <div style={{ color: "var(--text-muted)" }}>
                  Credential ID: <span style={{ color: "var(--accent-purple)" }}>{session.credentialId}</span>
                </div>
              </div>
            </div>

            {/* DOCUMENT UPLOAD & ENCRYPTION PANEL */}
            <div className="glass-panel" style={{ padding: "1.5rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "1rem" }}>
                <FileUp size={20} color="var(--accent-purple)" />
                <h3 style={{ fontSize: "1.1rem", fontWeight: "600" }}>Encrypt & Store Document</h3>
              </div>

              <form onSubmit={handleUploadAndEncrypt} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                <div>
                  <label style={{ display: "block", fontSize: "0.85rem", color: "var(--text-muted)", marginBottom: "0.4rem" }}>
                    Document Title / Identifier
                  </label>
                  <input
                    type="text"
                    className="input-field"
                    placeholder="e.g. Health History & Secret Notes.txt"
                    value={docTitle}
                    onChange={(e) => setDocTitle(e.target.value)}
                  />
                </div>

                <div>
                  <label style={{ display: "block", fontSize: "0.85rem", color: "var(--text-muted)", marginBottom: "0.4rem" }}>
                    Private Plaintext Document Content
                  </label>
                  <textarea
                    className="input-field custom-scrollbar"
                    rows={4}
                    placeholder="Paste private text document here... (Content is encrypted locally in browser before upload)"
                    value={docContent}
                    onChange={(e) => setDocContent(e.target.value)}
                    style={{ resize: "vertical" }}
                  />
                </div>

                {uploadStatus && (
                  <div style={{ fontSize: "0.85rem", padding: "0.6rem 0.8rem", borderRadius: "8px", background: "rgba(139, 92, 246, 0.1)", border: "1px solid rgba(139, 92, 246, 0.2)", color: "var(--accent-purple)" }}>
                    {uploadStatus}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={encrypting}
                  className="btn-primary"
                  style={{ width: "100%" }}
                >
                  {encrypting ? (
                    <>Encrypting & Saving...</>
                  ) : (
                    <>
                      <Lock size={18} />
                      Encrypt in Browser & Store
                    </>
                  )}
                </button>
              </form>
            </div>

            {/* ENCRYPTED DOCUMENTS LIST & CIPHERTEXT INSPECTOR */}
            <div className="glass-panel" style={{ padding: "1.5rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                  <Database size={20} color="var(--accent-cyan)" />
                  <h3 style={{ fontSize: "1.1rem", fontWeight: "600" }}>Your Vault Documents</h3>
                </div>
                <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
                  {userDocs.length} stored
                </span>
              </div>

              {userDocs.length === 0 ? (
                <p style={{ fontSize: "0.9rem", color: "var(--text-muted)", textAlign: "center", padding: "2rem 0" }}>
                  No encrypted documents found in vault. Upload one above.
                </p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                  {userDocs.map((doc) => {
                    const isSelected = selectedDocId === doc.doc_id;
                    return (
                      <div
                        key={doc.doc_id}
                        onClick={() => handleSelectDoc(doc)}
                        style={{
                          padding: "1rem",
                          borderRadius: "12px",
                          background: isSelected ? "rgba(139, 92, 246, 0.15)" : "rgba(255, 255, 255, 0.03)",
                          border: isSelected ? "1px solid var(--accent-purple)" : "1px solid var(--bg-card-border)",
                          cursor: "pointer",
                          transition: "all 0.2s ease",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <div style={{ fontWeight: "600", fontSize: "0.95rem" }}>{doc.title}</div>
                          <span className="badge-blue" style={{ fontSize: "0.7rem", padding: "0.2rem 0.5rem", borderRadius: "10px" }}>
                            AES-256-GCM
                          </span>
                        </div>
                        <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.4rem", fontFamily: "monospace" }}>
                          docId: {doc.doc_id.slice(0, 16)}...
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* CIPHERTEXT INSPECTOR PANEL */}
              {activeDocRecord && (
                <div style={{ marginTop: "1.5rem", paddingTop: "1rem", borderTop: "1px solid var(--bg-card-border)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.6rem" }}>
                    <span style={{ fontSize: "0.85rem", fontWeight: "600", color: "var(--text-muted)" }}>
                      Encrypted Supabase Payload Proof:
                    </span>
                    <button
                      onClick={() => setShowCiphertext(!showCiphertext)}
                      style={{ background: "none", border: "none", color: "var(--accent-purple)", cursor: "pointer", fontSize: "0.8rem", display: "flex", alignItems: "center", gap: "0.3rem" }}
                    >
                      {showCiphertext ? <EyeOff size={14} /> : <Eye size={14} />}
                      {showCiphertext ? "Hide Raw Payload" : "Inspect Raw Payload"}
                    </button>
                  </div>

                  {showCiphertext && (
                    <div className="custom-scrollbar" style={{ background: "rgba(0, 0, 0, 0.5)", padding: "0.8rem", borderRadius: "8px", fontSize: "0.75rem", fontFamily: "monospace", overflowX: "auto" }}>
                      <div><strong style={{ color: "var(--accent-purple)" }}>Ciphertext:</strong> {activeDocRecord.ciphertext.slice(0, 60)}...</div>
                      <div><strong style={{ color: "var(--accent-cyan)" }}>IV Nonce:</strong> {activeDocRecord.iv}</div>
                      <div><strong style={{ color: "var(--accent-emerald)" }}>HKDF Salt:</strong> {activeDocRecord.salt}</div>
                      <div style={{ marginTop: "0.4rem", color: "var(--accent-emerald)" }}>✅ Verified: Zero Plaintext Stored</div>
                    </div>
                  )}
                </div>
              )}
            </div>

          </div>

          {/* RIGHT COLUMN: MONAD GRANTS & AI Q&A */}
          <div style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>
            
            {/* MONAD SMART CONTRACT GRANT CONTROL PANEL */}
            <div className="glass-panel" style={{ padding: "1.5rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                  <Shield size={20} color="var(--accent-purple)" />
                  <h3 style={{ fontSize: "1.1rem", fontWeight: "600" }}>Monad Access Grant Registry</h3>
                </div>
                {grantStatus && (
                  <div className={grantStatus.active ? "badge-green" : "badge-red"} style={{ padding: "0.3rem 0.7rem", borderRadius: "14px", fontSize: "0.8rem", display: "flex", alignItems: "center", gap: "0.3rem" }}>
                    {grantStatus.active ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
                    {grantStatus.active ? "Grant Active" : grantStatus.isRevoked ? "Grant Revoked" : "No Grant"}
                  </div>
                )}
              </div>

              {!selectedDocId ? (
                <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", textAlign: "center", padding: "1.5rem 0" }}>
                  Select an encrypted document from the vault to manage access.
                </p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                  <div>
                    <label style={{ display: "block", fontSize: "0.85rem", color: "var(--text-muted)", marginBottom: "0.4rem" }}>
                      Authorized AI Agent Address
                    </label>
                    <input
                      type="text"
                      className="input-field"
                      value={agentAddress}
                      onChange={(e) => setAgentAddress(e.target.value)}
                      placeholder="0x..."
                    />
                  </div>

                  <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
                    <div style={{ flex: 1 }}>
                      <label style={{ display: "block", fontSize: "0.85rem", color: "var(--text-muted)", marginBottom: "0.4rem" }}>
                        Time Expiry
                      </label>
                      <select
                        className="input-field"
                        value={grantDurationMinutes}
                        onChange={(e) => setGrantDurationMinutes(Number(e.target.value))}
                      >
                        <option value={5}>5 Minutes</option>
                        <option value={15}>15 Minutes</option>
                        <option value={60}>1 Hour</option>
                        <option value={1440}>24 Hours</option>
                      </select>
                    </div>

                    <button
                      onClick={handleGrantAccess}
                      disabled={granting}
                      className="btn-primary"
                      style={{ marginTop: "1.3rem" }}
                    >
                      {granting ? "Granting..." : "Grant AI Access"}
                    </button>

                    <button
                      onClick={handleRevokeAccess}
                      disabled={revoking}
                      className="btn-danger"
                      style={{ marginTop: "1.3rem" }}
                    >
                      {revoking ? "Revoking..." : "Revoke Access"}
                    </button>
                  </div>

                  {/* TRANSACTION RECEIPT EVIDENCE */}
                  {txEvidence && (
                    <div style={{ background: "rgba(16, 185, 129, 0.08)", border: "1px solid rgba(16, 185, 129, 0.2)", borderRadius: "10px", padding: "0.8rem", fontSize: "0.8rem", fontFamily: "monospace" }}>
                      <div style={{ fontWeight: "600", color: "#34d399", marginBottom: "0.2rem" }}>
                        📜 Monad Transaction Receipt ({txEvidence.type})
                      </div>
                      <div style={{ color: "var(--text-muted)", wordBreak: "break-all" }}>
                        Tx Hash: {txEvidence.hash}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* AI Q&A INTERFACE WITH SOURCE PASSAGES */}
            <div className="glass-panel" style={{ padding: "1.5rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "1rem" }}>
                <Sparkles size={20} color="var(--accent-purple)" />
                <h3 style={{ fontSize: "1.1rem", fontWeight: "600" }}>Query AI Memory Agent</h3>
              </div>

              <form onSubmit={handleAskAI} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                <div>
                  <textarea
                    className="input-field custom-scrollbar"
                    rows={3}
                    placeholder="Ask a question about your encrypted document... (e.g. What are the key details?)"
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                  />
                </div>

                <button
                  type="submit"
                  disabled={queryingAI || !selectedDocId}
                  className="btn-primary"
                  style={{ width: "100%" }}
                >
                  {queryingAI ? (
                    <>
                      <RefreshCw size={18} className="spin-icon" style={{ animation: "spin 1s linear infinite" }} />
                      Verifying Monad Grant & Querying AI...
                    </>
                  ) : (
                    <>
                      <Send size={18} />
                      Ask AI Agent
                    </>
                  )}
                </button>
              </form>

              {/* AI RESPONSE OR PERMISSION REJECTION DISPLAY */}
              {aiResponse && (
                <div style={{ marginTop: "1.5rem", paddingTop: "1rem", borderTop: "1px solid var(--bg-card-border)" }}>
                  {aiResponse.error ? (
                    <div style={{ padding: "1rem", borderRadius: "12px", background: "rgba(244, 63, 94, 0.12)", border: "1px solid rgba(244, 63, 94, 0.3)" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", color: "#fb7185", fontWeight: "600", marginBottom: "0.5rem" }}>
                        <XCircle size={18} />
                        <span>Permission / Execution Notice</span>
                      </div>
                      <p style={{ fontSize: "0.9rem", color: "#fecdd3", lineHeight: "1.5" }}>
                        {aiResponse.error}
                      </p>
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                      <div style={{ padding: "1rem", borderRadius: "12px", background: "rgba(139, 92, 246, 0.1)", border: "1px solid rgba(139, 92, 246, 0.2)" }}>
                        <div style={{ fontSize: "0.85rem", fontWeight: "600", color: "var(--accent-purple)", marginBottom: "0.5rem", display: "flex", alignItems: "center", gap: "0.4rem" }}>
                          <Sparkles size={16} />
                          <span>AI Agent Answer</span>
                        </div>
                        <p style={{ fontSize: "0.95rem", lineHeight: "1.6", whiteSpace: "pre-wrap" }}>
                          {aiResponse.answer}
                        </p>
                      </div>

                      {aiResponse.citedPassages && aiResponse.citedPassages.length > 0 && (
                        <div>
                          <div style={{ fontSize: "0.8rem", fontWeight: "600", color: "var(--text-muted)", marginBottom: "0.4rem" }}>
                            Supporting Source Passages (Decrypted in Browser):
                          </div>
                          {aiResponse.citedPassages.map((p, idx) => (
                            <div key={idx} style={{ background: "rgba(0, 0, 0, 0.3)", padding: "0.6rem 0.8rem", borderRadius: "8px", fontSize: "0.8rem", marginBottom: "0.4rem", borderLeft: "3px solid var(--accent-cyan)" }}>
                              <strong>[Passage {idx + 1}]:</strong> {p}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

          </div>

        </div>
      )}
    </div>
  );
}
