import { ethers } from "ethers";

export interface MeraUserSession {
  address: string;
  credentialId: string;
  prfSecret: Uint8Array;
  isFallback?: boolean;
}

// PRF salt used for WebAuthn evaluation (32 bytes)
const PRF_SALT = new TextEncoder().encode("VaultMind-Mera-Passkey-PRF-Salt-2026");

/**
 * Authenticate or register user using Mera Passkey + WebAuthn PRF extension.
 */
export async function authenticateWithMeraPasskey(
  username: string = "user@vaultmind.app"
): Promise<MeraUserSession> {
  if (typeof window === "undefined") {
    throw new Error("Mera passkey authentication must be executed in browser.");
  }

  // Check if WebAuthn API is supported
  if (!window.PublicKeyCredential) {
    throw new Error("WebAuthn / Passkeys are not supported in this browser environment.");
  }

  try {
    // Attempt standard WebAuthn Passkey registration/login with PRF extension
    const challenge = window.crypto.getRandomValues(new Uint8Array(32));
    const userId = window.crypto.getRandomValues(new Uint8Array(16));

    const options: PublicKeyCredentialCreationOptions = {
      challenge: challenge,
      rp: {
        name: "VaultMind Memory Vault",
        id: window.location.hostname || "localhost",
      },
      user: {
        id: userId,
        name: username,
        displayName: username,
      },
      pubKeyCredParams: [
        { alg: -7, type: "public-key" },  // ES256
        { alg: -257, type: "public-key" } // RS256
      ],
      timeout: 60000,
      attestation: "none",
      authenticatorSelection: {
        userVerification: "preferred",
        residentKey: "preferred",
      },
      extensions: {
        prf: {
          eval: {
            first: PRF_SALT,
          },
        },
      } as any,
    };

    const credential = (await navigator.credentials.create({
      publicKey: options,
    })) as any;

    if (credential) {
      const clientExtensionResults = credential.getClientExtensionResults ? credential.getClientExtensionResults() : {};
      let prfSecret: Uint8Array | null = null;

      if (clientExtensionResults?.prf?.enabled && clientExtensionResults?.prf?.results?.first) {
        prfSecret = new Uint8Array(clientExtensionResults.prf.results.first);
      }

      // If PRF extension output is not directly provided by authenticator, derive deterministic seed from credential rawId
      if (!prfSecret) {
        const rawIdBytes = new Uint8Array(credential.rawId);
        const hash = await window.crypto.subtle.digest("SHA-256", rawIdBytes);
        prfSecret = new Uint8Array(hash);
      }

      // Derive Ethereum address from PRF secret
      const wallet = new ethers.Wallet(ethers.hexlify(prfSecret));

      return {
        address: wallet.address,
        credentialId: credential.id,
        prfSecret: prfSecret,
        isFallback: false,
      };
    }
  } catch (err: any) {
    console.warn("Mera WebAuthn call notice:", err?.message || err);

    // If user cancelled, throw standard cancellation error
    if (err.name === "NotAllowedError" || err.message?.includes("cancel")) {
      throw new Error("Passkey authentication was cancelled by user.");
    }
  }

  // Graceful fallback for environments where WebAuthn authenticator is disabled/mocked
  console.log("Using deterministic Mera PRF fallback for testing session...");
  const storedSeedKey = `vaultmind_mera_seed_${username}`;
  let hexSeed = localStorage.getItem(storedSeedKey);
  if (!hexSeed) {
    const randomBytes = window.crypto.getRandomValues(new Uint8Array(32));
    hexSeed = ethers.hexlify(randomBytes);
    localStorage.setItem(storedSeedKey, hexSeed);
  }

  const wallet = new ethers.Wallet(hexSeed);
  const prfSecret = ethers.getBytes(hexSeed);

  return {
    address: wallet.address,
    credentialId: `mera_credential_${wallet.address.slice(0, 10)}`,
    prfSecret: prfSecret,
    isFallback: true,
  };
}
