#!/usr/bin/env node
// VAPID key çifti oluşturucu — deployment öncesi bir kez çalıştırın
// Kullanım: node scripts/generate-vapid.js
// Çıktıları wrangler.toml [vars] bölümüne ve index.html meta[name=vapid-key] içine yapıştırın.

async function main() {
  const { webcrypto } = await import('node:crypto');
  const crypto = webcrypto;

  const pair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify']
  );

  // Raw public key (65 bytes uncompressed)
  const pubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));

  // JWK private key → d field (32 bytes raw)
  const privJwk = await crypto.subtle.exportKey('jwk', pair.privateKey);

  function b64url(bytes) {
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    return Buffer.from(binary, 'binary').toString('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }

  const publicKey  = b64url(pubRaw);
  const privateKey = privJwk.d;  // already base64url from JWK

  console.log('\n=== VAPID Keys ===\n');
  console.log('VAPID_PUBLIC_KEY  =', publicKey);
  console.log('VAPID_PRIVATE_KEY =', privateKey);
  console.log('\nwrangler.toml [vars] bölümüne ekleyin:');
  console.log(`\nVAPID_PUBLIC_KEY = "${publicKey}"`);
  console.log(`VAPID_PRIVATE_KEY = "${privateKey}"`);
  console.log(`\nindex.html <meta name="vapid-key" content="${publicKey}">`);
}

main().catch(console.error);
