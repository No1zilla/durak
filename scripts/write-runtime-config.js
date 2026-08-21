/**
 * Writes client/runtime-config.js from DURAK_API_ORIGIN.
 * Used before VK static hosting deploy so the CDN copy points at Cloudflare, not Railway.
 */
const fs = require('fs');
const path = require('path');

const origin = String(process.env.DURAK_API_ORIGIN || '').trim().replace(/\/$/, '');
const file = path.join(__dirname, '../client/runtime-config.js');
const body = origin
  ? `/* VK/Pages static host → API (Cloudflare proxy, not raw Railway). */\nwindow.DURAK_API_ORIGIN = ${JSON.stringify(origin)};\n`
  : `/* Empty = same-origin (Railway or Cloudflare proxy). */\nwindow.DURAK_API_ORIGIN = '';\n`;

fs.writeFileSync(file, body);
process.stdout.write(`wrote ${file} DURAK_API_ORIGIN=${origin || '(empty same-origin)'}\n`);
