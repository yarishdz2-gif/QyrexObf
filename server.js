const express = require('express');
const mongoose = require('mongoose');
const crypto = require('crypto');
let qyrexObfuscate = null;
try {
  ({ obfuscate: qyrexObfuscate } = require('./obfuscate'));
} catch (e) {
  console.warn('[SECURITY] ./obfuscate is unavailable; only local packaging can be used:', e.message);
}
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');

const app = express();
app.set('trust proxy', 1);

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

function requireProductionSecret(name, configuredValue, bytes) {
  const value = String(configuredValue || '').trim();
  if (value) return value;
  if (IS_PRODUCTION) {
    throw new Error(`[SECURITY] ${name} is required in production.`);
  }
  const generated = crypto.randomBytes(bytes).toString('base64url');
  console.warn(`[SECURITY] ${name} is not configured; using an ephemeral development secret.`);
  return generated;
}

function normalizePublicBase(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('[SECURITY] PUBLIC_BASE_URL must be an absolute URL.');
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash ||
      (parsed.pathname && parsed.pathname !== '/')) {
    throw new Error('[SECURITY] PUBLIC_BASE_URL must contain only scheme and host.');
  }
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && !IS_PRODUCTION)) {
    throw new Error('[SECURITY] PUBLIC_BASE_URL must use HTTPS in production.');
  }
  return parsed.origin;
}

function parseOriginSet(value) {
  const result = new Set();
  for (const part of String(value || '').split(',')) {
    const candidate = part.trim();
    if (!candidate) continue;
    try {
      const origin = new URL(candidate).origin;
      if (origin !== 'null') result.add(origin);
    } catch {
      throw new Error('[SECURITY] CORS_ORIGINS contains an invalid origin.');
    }
  }
  return result;
}

function decodeSourceKey(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const key = /^[0-9a-f]{64}$/i.test(raw)
    ? Buffer.from(raw, 'hex')
    : Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  if (key.length !== 32) {
    throw new Error('[SECURITY] SCRIPT_SOURCE_KEY must be exactly 32 bytes (base64/base64url or 64 hex chars).');
  }
  return key;
}

const JWT_SECRET = requireProductionSecret('JWT_SECRET', process.env.JWT_SECRET, 48);
const PUBLIC_BASE_URL = normalizePublicBase(process.env.PUBLIC_BASE_URL);
if (IS_PRODUCTION && !PUBLIC_BASE_URL) {
  throw new Error('[SECURITY] PUBLIC_BASE_URL is required in production.');
}
const SOURCE_ENCRYPTION_KEY = decodeSourceKey(process.env.SCRIPT_SOURCE_KEY);
if (IS_PRODUCTION && !SOURCE_ENCRYPTION_KEY) {
  throw new Error('[SECURITY] SCRIPT_SOURCE_KEY is required in production.');
}
if (!SOURCE_ENCRYPTION_KEY) {
  console.warn('[SECURITY] SCRIPT_SOURCE_KEY is not configured; source code is stored in plaintext in development only.');
}

const CORS_ORIGINS = parseOriginSet(process.env.CORS_ORIGINS);
if (PUBLIC_BASE_URL) CORS_ORIGINS.add(PUBLIC_BASE_URL);

const MONGO_URI = process.env.MONGO_URI || '';
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'openrouter/auto';

const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID || '';
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || '';
const DISCORD_REDIRECT_URI = process.env.DISCORD_REDIRECT_URI || '';

const PORT = process.env.PORT || 10000;

function protectSourceAtRest(source) {
  const plaintext = String(source || '');
  if (!SOURCE_ENCRYPTION_KEY) return plaintext;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', SOURCE_ENCRYPTION_KEY, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['enc', 'v1', iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join(':');
}

function revealSourceAtRest(value) {
  const stored = String(value || '');
  if (!stored.startsWith('enc:v1:')) return stored;
  if (!SOURCE_ENCRYPTION_KEY) {
    throw new Error('Source encryption is configured in the database but SCRIPT_SOURCE_KEY is unavailable.');
  }
  const parts = stored.split(':');
  if (parts.length !== 5 || parts[0] !== 'enc' || parts[1] !== 'v1') {
    throw new Error('Invalid encrypted source format.');
  }
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', SOURCE_ENCRYPTION_KEY,
      Buffer.from(parts[2], 'base64url'));
    decipher.setAuthTag(Buffer.from(parts[3], 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(parts[4], 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    throw new Error('Encrypted source cannot be authenticated. Check SCRIPT_SOURCE_KEY.');
  }
}

app.use(helmet({
  contentSecurityPolicy: false,
  frameguard: { action: 'deny' },
  referrerPolicy: { policy: 'no-referrer' },
  hidePoweredBy: true
}));
app.disable('x-powered-by');
app.use(cors({
  origin(origin, done) {
    if (!origin) return done(null, false);
    return done(null, CORS_ORIGINS.has(origin));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Authorization', 'Content-Type'],
  maxAge: 600
}));
app.use(express.json({ limit: '2mb' }));

function clientIp(req) {
  const resolved = req && req.ip ? String(req.ip) : '';
  const direct = req && req.socket && req.socket.remoteAddress ? String(req.socket.remoteAddress) : '';
  return (resolved || direct || '?').replace(/^::ffff:/, '');
}

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => clientIp(req),
  message: { error: 'Demasiadas peticiones. Espera un poco.' }
});
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  keyGenerator: (req) => clientIp(req),
  message: { error: 'Demasiados intentos de login/registro' }
});
const rawLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  keyGenerator: (req) => clientIp(req),
  message:
