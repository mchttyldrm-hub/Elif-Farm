#!/usr/bin/env node
// VAPID key çifti oluşturucu — deployment öncesi bir kez çalıştırın
// Kullanım: node scripts/generate-vapid.js
//
// Gereksinim: Node.js 15+
// Çıktıları wrangler.toml [vars] ve index.html meta[name=vapid-key] içine yapıştırın.

'use strict';

const { webcrypto } = require('crypto');
const subtle = webcrypto.subtle;

function b64url(bytes) {
  const buf = Buffer.from(bytes);
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function main() {
  const pair = await subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify']
  );

  // Raw public key (65 bytes: 0x04 | x | y)
  const pubRaw = new Uint8Array(await subtle.exportKey('raw', pair.publicKey));

  // JWK private key → d field is already base64url
  const privJwk = await subtle.exportKey('jwk', pair.privateKey);

  const publicKey  = b64url(pubRaw);
  const privateKey = privJwk.d;

  console.log('\n=== VAPID Keys ===\n');
  console.log('wrangler.toml [vars] bölümüne ekleyin:\n');
  console.log(`VAPID_PUBLIC_KEY  = "${publicKey}"`);
  console.log(`VAPID_PRIVATE_KEY = "${privateKey}"`);
  console.log('\nindex.html içinde güncelleyin:\n');
  console.log(`<meta name="vapid-key" content="${publicKey}">`);
}

main().catch(err => { console.error(err); process.exit(1); });
