/**
 * Web Authentication API (WebAuthn) integration for Face ID/Touch ID biometric authentication.
 * 
 * This module provides a simple interface for:
 * - Enrolling biometric credentials during onboarding
 * - Authenticating users on app reopen
 * - Managing stored credentials
 * 
 * Security Model:
 * - Credentials are platform-bound (Face ID/Touch ID on iPhone)
 * - Private keys never leave the device
 * - This provides access control, not data encryption (localStorage is still plaintext)
 */

import type { BiometricCredential } from "../types";

export type BiometricEnrollResult = 
  | { success: true; credential: BiometricCredential }
  | { success: false; error: string };

export type BiometricAuthResult = 
  | { success: true }
  | { success: false; error: string };

/**
 * Check if Web Authentication API is supported by the browser.
 */
export function supportsBiometric(): boolean {
  return (
    "credentials" in navigator &&
    "create" in navigator.credentials &&
    typeof PublicKeyCredential !== "undefined"
  );
}

/**
 * Enroll a new biometric credential for the current user.
 * This should be called during onboarding or in settings.
 * 
 * @param username - User identifier (typically their name from onboarding)
 * @returns Result with credential details or error
 */
export async function enrollBiometric(username: string): Promise<BiometricEnrollResult> {
  if (!supportsBiometric()) {
    return {
      success: false,
      error: "Biometric authentication is not supported on this device."
    };
  }

  try {
    // Generate a challenge (in production, this should come from server)
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    
    // User identifier
    const userId = crypto.getRandomValues(new Uint8Array(16));

    // Create credential
    const credential = await navigator.credentials.create({
      publicKey: {
        challenge,
        rp: {
          name: "Companion",
          id: window.location.hostname
        },
        user: {
          id: userId,
          name: username,
          displayName: username
        },
        pubKeyCredParams: [
          // Prefer ES256 (ECDSA with SHA-256)
          { type: "public-key", alg: -7 },
          // Fallback to RS256 (RSA with SHA-256)
          { type: "public-key", alg: -257 }
        ],
        authenticatorSelection: {
          authenticatorAttachment: "platform", // Require platform authenticator (Face ID/Touch ID)
          userVerification: "required",
          requireResidentKey: false
        },
        timeout: 60000,
        attestation: "none" // We don't need attestation for this use case
      }
    });

    if (!credential || !(credential instanceof PublicKeyCredential)) {
      return {
        success: false,
        error: "Failed to create biometric credential."
      };
    }

    // Extract credential details
    const credentialId = arrayBufferToBase64(credential.rawId);
    const response = credential.response as AuthenticatorAttestationResponse;
    const publicKey = arrayBufferToBase64(response.getPublicKey() ?? new ArrayBuffer(0));

    return {
      success: true,
      credential: {
        credentialId,
        publicKey,
        enrolledAt: new Date().toISOString()
      }
    };
  } catch (error) {
    let errorMessage = "Failed to enroll biometric authentication.";
    
    if (error instanceof Error) {
      // User cancelled or error occurred
      if (error.name === "NotAllowedError") {
        errorMessage = "Biometric authentication was cancelled.";
      } else if (error.name === "InvalidStateError") {
        errorMessage = "A credential already exists for this authenticator.";
      } else {
        errorMessage = error.message;
      }
    }

    return {
      success: false,
      error: errorMessage
    };
  }
}

/**
 * Authenticate using an existing biometric credential.
 * This should be called when the app opens (if biometric is enabled).
 * 
 * @param credential - The stored credential to authenticate against
 * @returns Result indicating success or error
 */
export async function authenticateBiometric(
  credential: BiometricCredential
): Promise<BiometricAuthResult> {
  if (!supportsBiometric()) {
    return {
      success: false,
      error: "Biometric authentication is not supported on this device."
    };
  }

  try {
    // Generate a challenge (in production, this should come from server)
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    
    // Convert stored credential ID back to ArrayBuffer
    const credentialIdBuffer = base64ToArrayBuffer(credential.credentialId);

    // Request authentication
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge,
        rpId: window.location.hostname,
        allowCredentials: [
          {
            id: credentialIdBuffer,
            type: "public-key",
            transports: ["internal"] // Platform authenticator
          }
        ],
        userVerification: "required",
        timeout: 60000
      }
    });

    if (!assertion || !(assertion instanceof PublicKeyCredential)) {
      return {
        success: false,
        error: "Biometric authentication failed."
      };
    }

    // In a real implementation, you would verify the signature on the server
    // For this PWA, we just check that authentication was successful
    return { success: true };
  } catch (error) {
    let errorMessage = "Biometric authentication failed.";
    
    if (error instanceof Error) {
      if (error.name === "NotAllowedError") {
        errorMessage = "Biometric authentication was cancelled.";
      } else {
        errorMessage = error.message;
      }
    }

    return {
      success: false,
      error: errorMessage
    };
  }
}

// Helper functions

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const binary = String.fromCharCode(...bytes);
  return window.btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}
