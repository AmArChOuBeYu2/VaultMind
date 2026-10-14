/**
 * Web Crypto API utilities for browser-side AES-256-GCM encryption & decryption
 * with HKDF-SHA-256 key derivation from Mera passkey PRF output secret.
 */

// Helper functions for Base64 <-> Uint8Array conversion
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Derive AES-256-GCM CryptoKey using HKDF-SHA-256 from Mera PRF master secret and salt.
 */
export async function deriveDocumentEncryptionKey(
  prfSecret: Uint8Array,
  salt: Uint8Array
): Promise<CryptoKey> {
  const subtle = window.crypto.subtle;

  // Ensure ArrayBuffer satisfies BufferSource
  const secretBuffer = new Uint8Array(prfSecret).buffer as ArrayBuffer;
  const saltBuffer = new Uint8Array(salt).buffer as ArrayBuffer;

  // Import master PRF secret as HKDF key material
  const masterKey = await subtle.importKey(
    "raw",
    secretBuffer,
    { name: "HKDF" },
    false,
    ["deriveKey"]
  );

  // Derive 256-bit AES-GCM key
  const derivedKey = await subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: saltBuffer,
      info: new TextEncoder().encode("VaultMind-Document-AES-256-GCM"),
    },
    masterKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );

  return derivedKey;
}

export interface EncryptedPayload {
  ciphertext: string; // base64
  iv: string;         // base64
  salt: string;       // base64
}

/**
 * Encrypt plaintext document string using AES-256-GCM.
 */
export async function encryptDocument(
  plaintext: string,
  prfSecret: Uint8Array
): Promise<EncryptedPayload> {
  const subtle = window.crypto.subtle;
  const encoder = new TextEncoder();
  const data = encoder.encode(plaintext);

  // Generate 16-byte random salt and 12-byte random IV
  const salt = window.crypto.getRandomValues(new Uint8Array(16));
  const iv = window.crypto.getRandomValues(new Uint8Array(12));

  // Derive key
  const key = await deriveDocumentEncryptionKey(prfSecret, salt);

  // Encrypt
  const encryptedBuffer = await subtle.encrypt(
    {
      name: "AES-GCM",
      iv: iv,
    },
    key,
    data
  );

  return {
    ciphertext: arrayBufferToBase64(encryptedBuffer),
    iv: arrayBufferToBase64(iv.buffer as ArrayBuffer),
    salt: arrayBufferToBase64(salt.buffer as ArrayBuffer),
  };
}

/**
 * Decrypt base64 ciphertext using AES-256-GCM and PRF secret.
 */
export async function decryptDocument(
  payload: EncryptedPayload,
  prfSecret: Uint8Array
): Promise<string> {
  try {
    const subtle = window.crypto.subtle;
    const ciphertextBuffer = base64ToArrayBuffer(payload.ciphertext);
    const ivBuffer = new Uint8Array(base64ToArrayBuffer(payload.iv));
    const saltBuffer = new Uint8Array(base64ToArrayBuffer(payload.salt));

    const key = await deriveDocumentEncryptionKey(prfSecret, saltBuffer);

    const decryptedBuffer = await subtle.decrypt(
      {
        name: "AES-GCM",
        iv: ivBuffer,
      },
      key,
      ciphertextBuffer
    );

    const decoder = new TextDecoder();
    return decoder.decode(decryptedBuffer);
  } catch (err: any) {
    throw new Error(
      `Decryption failed: Incorrect passkey key or corrupted ciphertext payload. (${err?.message || "AEAD integrity check failed"})`
    );
  }
}
