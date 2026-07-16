// 工務店名簿JSONをAES-GCMで暗号化し、公開リポジトリに置ける data.js を生成する。
// 使い方: node tools/encrypt.mjs tools/_plain.json <パスワード>
// ※ _plain.json(平文)は絶対にコミットしないこと。
import { webcrypto as crypto } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const [,, plainPath, password] = process.argv;
if (!plainPath || !password) {
  console.error('usage: node tools/encrypt.mjs <plain.json> <password>');
  process.exit(1);
}

const PBKDF2_ITERATIONS = 310000; // index.html側と必ず一致させる

const plaintext = new TextEncoder().encode(readFileSync(plainPath, 'utf-8'));
const salt = crypto.getRandomValues(new Uint8Array(16));
const iv = crypto.getRandomValues(new Uint8Array(12));

const baseKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
const key = await crypto.subtle.deriveKey(
  { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
  baseKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
);
const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext));

const b64 = (u8) => Buffer.from(u8).toString('base64');
const payload = { v: 1, iter: PBKDF2_ITERATIONS, salt: b64(salt), iv: b64(iv), data: b64(cipher) };
writeFileSync(new URL('../data.js', import.meta.url), 'window.OM_ENC = ' + JSON.stringify(payload) + ';\n');

// ラウンドトリップ検証(復号して先頭件を確認)
const dec = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
const arr = JSON.parse(new TextDecoder().decode(dec));
console.log('encrypted OK. rows=' + arr.length + ' first=' + JSON.stringify(arr[0]));
