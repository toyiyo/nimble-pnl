// Encryption utility for securing sensitive data
export class EncryptionService {
  private key: CryptoKey | null = null;
  
  async init(encryptionKey: string): Promise<void> {
    // Import the key for AES-GCM encryption
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(encryptionKey.padEnd(32, '0').slice(0, 32)), // Ensure 32 bytes
      'AES-GCM',
      false,
      ['encrypt', 'decrypt']
    );
    this.key = keyMaterial;
  }

  async encrypt(data: string): Promise<string> {
    if (!this.key) {
      throw new Error('Encryption key not initialized');
    }

    const encoder = new TextEncoder();
    const iv = crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV for AES-GCM
    
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      this.key,
      encoder.encode(data)
    );

    // Combine IV and encrypted data
    const combined = new Uint8Array(iv.length + encrypted.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(encrypted), iv.length);

    // Return base64 encoded
    return btoa(String.fromCharCode(...combined));
  }

  async decrypt(encryptedData: string): Promise<string> {
    if (!this.key) {
      throw new Error('Encryption key not initialized');
    }

    try {
      // Decode base64
      const combined = new Uint8Array(
        atob(encryptedData).split('').map(c => c.charCodeAt(0))
      );

      // Extract IV and encrypted data
      const iv = combined.slice(0, 12);
      const encrypted = combined.slice(12);

      const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        this.key,
        encrypted
      );

      return new TextDecoder().decode(decrypted);
    } catch (error) {
      throw new Error('Failed to decrypt data');
    }
  }
}

// Singleton instance
let encryptionService: EncryptionService | null = null;

export async function getEncryptionService(): Promise<EncryptionService> {
  if (!encryptionService) {
    const encryptionKey = Deno.env.get('ENCRYPTION_KEY');
    if (!encryptionKey) {
      throw new Error('Encryption key not configured');
    }
    
    encryptionService = new EncryptionService();
    await encryptionService.init(encryptionKey);
  }
  
  return encryptionService;
}

// Security audit logging
export async function logSecurityEvent(
  supabase: any, 
  event: string, 
  userId?: string, 
  restaurantId?: string, 
  metadata?: Record<string, any>
): Promise<void> {
  try {
    console.log(`SECURITY AUDIT: ${event}`, { 
      userId, 
      restaurantId, 
      timestamp: new Date().toISOString(),
      ...metadata 
    });
    
    // Store in audit log table if it exists
    // For now, we'll just log to console for security monitoring
  } catch (error) {
    console.error('Failed to log security event:', error);
  }
}