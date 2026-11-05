import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import nodemailer from 'nodemailer';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT) || 3001;
const isProduction = process.env.NODE_ENV === 'production';
const dataDirectory = path.resolve(process.env.DATA_DIRECTORY || path.join(__dirname, 'data'));
const dataFile = path.join(dataDirectory, 'store.json');
const databaseUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_PRISMA_URL;
const usesDatabase = Boolean(process.env.VERCEL || databaseUrl || isProduction);
const databasePool = usesDatabase && databaseUrl
  ? new pg.Pool({ connectionString: databaseUrl, max: 1, idleTimeoutMillis: 10_000 })
  : null;
const sessionCookie = 'tobs_session';
const superAdminEmail = 'ayodeletobs@gmail.com';
const sessions = new Map();
const rateLimits = new Map();
const frontendOrigin = process.env.FRONTEND_ORIGIN || 'https://deeril.github.io';

if (!usesDatabase) fs.mkdirSync(dataDirectory, { recursive: true });

let databaseSetupPromise;
let databaseRequestClient = null;
let databaseStoreDirty = false;

function readStore() {
  if (!fs.existsSync(dataFile)) return { users: [], invitations: [], passwordResets: [], stops: [], sessions: [], supportThreads: [], superAdminChallenges: [] };
  const parsed = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  return {
    users: Array.isArray(parsed.users) ? parsed.users : [],
    invitations: Array.isArray(parsed.invitations) ? parsed.invitations : [],
    passwordResets: Array.isArray(parsed.passwordResets) ? parsed.passwordResets : [],
    stops: Array.isArray(parsed.stops) ? parsed.stops : [],
    sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
    supportThreads: Array.isArray(parsed.supportThreads) ? parsed.supportThreads : [],
    superAdminChallenges: Array.isArray(parsed.superAdminChallenges) ? parsed.superAdminChallenges : []
  };
}

let store = readStore();

function writeStore() {
  if (usesDatabase) {
    if (!databaseRequestClient) throw new Error('Persistent database writes must run inside an API request.');
    databaseStoreDirty = true;
    return;
  }
  const temporaryFile = `${dataFile}.tmp`;
  fs.writeFileSync(temporaryFile, JSON.stringify(store, null, 2), { mode: 0o600 });
  fs.renameSync(temporaryFile, dataFile);
}

function restoreStoredSessions() {
  sessions.clear();
  for (const session of store.sessions) {
    if (session.expiresAt > Date.now()) sessions.set(session.token, {
      userId: session.userId,
      expiresAt: session.expiresAt,
      superAdminVerified: session.superAdminVerified === true
    });
  }
  store.sessions = store.sessions.filter(session => session.expiresAt > Date.now());
}

async function ensureDatabaseTable() {
  if (!databasePool) throw new Error('Set DATABASE_URL in the production environment to connect a persistent PostgreSQL database.');
  if (!databaseSetupPromise) {
    databaseSetupPromise = databasePool.query(`
      CREATE TABLE IF NOT EXISTS tobs_app_state (
        id SMALLINT PRIMARY KEY CHECK (id = 1),
        state JSONB NOT NULL
      )
    `).then(() => databasePool.query(`
      INSERT INTO tobs_app_state (id, state)
      VALUES (1, '{"users":[],"invitations":[],"passwordResets":[],"stops":[],"sessions":[]}'::jsonb)
      ON CONFLICT (id) DO NOTHING
    `)).catch(error => {
      databaseSetupPromise = null;
      throw error;
    });
  }
  await databaseSetupPromise;
}

async function loadDatabaseStore(client) {
  await client.query('BEGIN');
  const { rows } = await client.query('SELECT state FROM tobs_app_state WHERE id = 1 FOR UPDATE');
  const state = rows[0]?.state;
  if (!state || typeof state !== 'object') throw new Error('The persistent application data is invalid.');
  store = {
    users: Array.isArray(state.users) ? state.users : [],
    invitations: Array.isArray(state.invitations) ? state.invitations : [],
    passwordResets: Array.isArray(state.passwordResets) ? state.passwordResets : [],
    stops: Array.isArray(state.stops) ? state.stops : [],
    sessions: Array.isArray(state.sessions) ? state.sessions : [],
    supportThreads: Array.isArray(state.supportThreads) ? state.supportThreads : [],
    superAdminChallenges: Array.isArray(state.superAdminChallenges) ? state.superAdminChallenges : []
  };
  restoreStoredSessions();
}

function persistentApiState(request, response, next) {
  if (!usesDatabase) return next();
  if (!databasePool) {
    return response.status(503).json({ error: 'The production database connection is missing. Set DATABASE_URL to a persistent PostgreSQL connection string in the service environment.' });
  }

  ensureDatabaseTable()
    .then(() => databasePool.connect())
    .then(async client => {
      try {
        await loadDatabaseStore(client);
        databaseRequestClient = client;
        databaseStoreDirty = false;
        let responseEnding = false;
        const endResponse = response.end.bind(response);
        response.end = (...args) => {
          if (responseEnding) return response;
          responseEnding = true;
          (async () => {
            try {
              if (databaseStoreDirty) {
                await client.query('UPDATE tobs_app_state SET state = $1::jsonb WHERE id = 1', [JSON.stringify(store)]);
              }
              await client.query('COMMIT');
            } catch (error) {
              console.error('Could not commit application data:', error);
              try {
                await client.query('ROLLBACK');
              } catch (rollbackError) {
                console.error('Could not roll back application data transaction:', rollbackError);
              }
              response.statusCode = 503;
              response.removeHeader('Content-Length');
              response.removeHeader('ETag');
              response.setHeader('Content-Type', 'application/json; charset=utf-8');
              endResponse(JSON.stringify({ error: 'The account database is temporarily unavailable. Please try again.' }));
              return;
            } finally {
              databaseRequestClient = null;
              databaseStoreDirty = false;
              client.release();
            }
            endResponse(...args);
          })();
          return response;
        };
        next();
      } catch (error) {
        try {
          await client.query('ROLLBACK');
        } catch (rollbackError) {
          console.error('Could not roll back application data transaction:', rollbackError);
        }
        client.release();
        console.error('Could not load application data:', error);
        response.status(503).json({ error: 'The account database could not be reached. Check the PostgreSQL connection settings and try again.' });
      }
    })
    .catch(error => {
      console.error('Could not connect to the account database:', error);
      response.status(503).json({ error: 'The account database could not be reached. Check the PostgreSQL connection settings and try again.' });
    });
}

function publicUser(user) {
  const { passwordHash: _passwordHash, passwordSalt: _passwordSalt, ...safeUser } = user;
  return safeUser;
}

function passwordHash(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { passwordSalt: salt, passwordHash: hash };
}

function verifyPassword(password, user) {
  const expected = Buffer.from(user.passwordHash, 'hex');
  const actual = Buffer.from(passwordHash(password, user.passwordSalt).passwordHash, 'hex');
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function setSessionCookie(response, token, remember = true) {
  response.cookie(sessionCookie, token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: frontendOrigin && isProduction ? 'none' : 'strict',
    path: '/',
    ...(remember ? { maxAge: 12 * 60 * 60 * 1000 } : {})
  });
}

function sessionUser(request) {
  const token = request.cookies?.[sessionCookie];
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }
  const user = store.users.find(item => item.id === session.userId);
  return user ? publicUser(user) : null;
}

function requireUser(request, response, next) {
  const user = sessionUser(request);
  if (!user) return response.status(401).json({ error: 'Please sign in to continue.' });
  request.user = user;
  return next();
}

function requireAdmin(request, response, next) {
  if (request.user?.role !== 'ADMIN') {
    return response.status(403).json({ error: 'Only a dispatcher admin can perform this action.' });
  }
  return next();
}

function requireSupportAccess(request, response, next) {
  if (!request.user || !['ADMIN', 'DRIVER', 'CUSTOMER_CARE'].includes(request.user.role)) {
    return response.status(403).json({ error: 'This account is not authorized to access support.' });
  }
  return next();
}

function requireCustomerCare(request, response, next) {
  if (request.user?.role !== 'CUSTOMER_CARE') {
    return response.status(403).json({ error: 'Only Customer Care accounts can reply to support cases.' });
  }
  return next();
}

function isSuperAdmin(user) {
  return user?.role === 'ADMIN' && user.email?.trim().toLowerCase() === superAdminEmail;
}

function requireSuperAdmin(request, response, next) {
  if (!isSuperAdmin(request.user)) {
    return response.status(403).json({ error: 'This account is not authorized to access platform administration.' });
  }
  const session = sessions.get(request.cookies?.[sessionCookie]);
  if (!session?.superAdminVerified) {
    return response.status(401).json({ error: 'Owner email verification is required. Sign in again to request a code.' });
  }
  return next();
}

function rateLimit({ windowMs = 15 * 60 * 1000, limit = 30 } = {}) {
  return (request, response, next) => {
    const key = `${request.ip}:${request.path}`;
    const now = Date.now();
    const entry = rateLimits.get(key);
    if (!entry || entry.resetAt <= now) {
      rateLimits.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    entry.count += 1;
    if (entry.count > limit) {
      return response.status(429).json({ error: 'Too many requests. Please try again later.' });
    }
    return next();
  };
}

function validEmail(value) {
  return typeof value === 'string'
    && value.length <= 254
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function classifySupportIssue(message) {
  const normalized = message.toLowerCase();
  if (/(bank|account|identity|passport|documents|private|invoice|payment|sensitive|customer data|address|phone number|otp|pin)/i.test(normalized)) {
    return 'SENSITIVE';
  }
  if (/(login|log in|sign in|password|forgot password|reset password|locked out|access)/i.test(normalized)) {
    return 'LOGIN';
  }
  if (/(track|tracking|location|where is|live location|driver location|route status)/i.test(normalized)) {
    return 'TRACKING';
  }
  if (/(route|delivery|stop|late|missed|order|address)/i.test(normalized)) {
    return 'DELIVERY';
  }
  return 'GENERAL';
}

function buildSupportBotReply(message) {
  const issueType = classifySupportIssue(message);

  if (issueType === 'LOGIN') {
    return {
      text: 'Your sign-in issue is usually solved by resetting your password from the login screen. If you still cannot access your account, reply with the email address on the account and a Customer Care agent will take over.',
      escalated: false
    };
  }

  if (issueType === 'TRACKING') {
    return {
      text: 'Check the live route list and map in the app first. If a driver is not sharing their location, ask them to enable live location sharing from their app screen. If the issue continues, I will escalate this to Customer Care.',
      escalated: false
    };
  }

  if (issueType === 'DELIVERY') {
    return {
      text: 'Please confirm the stop name or delivery address in your message so we can review the route. If this is a late delivery, missed stop, or wrong stop assignment, I have opened a case for Customer Care to review.',
      escalated: true
    };
  }

  if (issueType === 'SENSITIVE') {
    return {
      text: 'This looks like a private account or customer data issue, so I have escalated it to Customer Care immediately. Do not share passwords, OTP codes, or sensitive delivery details in the chat.',
      escalated: true
    };
  }

  return {
    text: 'I have logged this issue and a Customer Care agent will review it. Please add the exact stop, route, email, or account detail so the team can resolve it quickly.',
    escalated: true
  };
}

function cleanText(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function issueSession(response, user, remember = true, superAdminVerified = false) {
  const token = crypto.randomBytes(32).toString('base64url');
  const session = { userId: user.id, expiresAt: Date.now() + 12 * 60 * 60 * 1000, superAdminVerified };
  sessions.set(token, session);
  store.sessions = [...store.sessions.filter(item => item.token !== token), { token, ...session }];
  writeStore();
  setSessionCookie(response, token, remember);
  return publicUser(user);
}

function createTransport() {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const password = process.env.SMTP_PASSWORD?.replace(/\s/g, '');
  if (!host || !user || !password || !process.env.SMTP_FROM) {
    throw new Error('SMTP is not configured. Set SMTP_HOST, SMTP_USER, SMTP_PASSWORD, and SMTP_FROM on the server.');
  }
  const secure = process.env.SMTP_SECURE === 'true' || process.env.SMTP_PORT === '465';
  return nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT) || (secure ? 465 : 587),
    secure,
    auth: { user, pass: password }
  });
}

function emailFailureMessage(error) {
  if (error?.code === 'EAUTH' || error?.responseCode === 535) {
    return 'The mail server rejected the SMTP credentials. Check the SMTP username, app password, and authorized sender in your hosting settings.';
  }
  if (['ECONNECTION', 'ETIMEDOUT', 'ESOCKET'].includes(error?.code)) {
    return 'The app could not connect to the SMTP server. Check the SMTP host, port, and secure setting in your hosting settings.';
  }
  if (Number.isInteger(error?.responseCode) && error.responseCode >= 500) {
    return 'The mail server rejected the message. Check the authorized sender address and SMTP settings in your hosting settings.';
  }
  return 'The email could not be sent. Check the SMTP settings in your hosting settings and try again.';
}

function logEmailFailure(context, error) {
  console.error(context, {
    code: typeof error?.code === 'string' ? error.code : 'UNKNOWN',
    responseCode: Number.isInteger(error?.responseCode) ? error.responseCode : null
  });
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

app.disable('x-powered-by');
app.set('trust proxy', isProduction ? 1 : false);
app.use(express.json({ limit: '8mb' }));
app.use((request, response, next) => {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (frontendOrigin && request.headers.origin === frontendOrigin) {
    response.setHeader('Access-Control-Allow-Origin', frontendOrigin);
    response.setHeader('Access-Control-Allow-Credentials', 'true');
    response.setHeader('Vary', 'Origin');
    if (request.method === 'OPTIONS') {
      response.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
      response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      return response.sendStatus(204);
    }
  }
  next();
});
app.use('/api', persistentApiState);

app.get('/api/health', (request, response) => {
  response.json({ ok: true, storage: usesDatabase ? 'postgres' : 'local-json' });
});
app.use((request, response, next) => {
  const cookieHeader = request.headers.cookie || '';
  request.cookies = Object.fromEntries(cookieHeader.split(';').filter(Boolean).map(part => {
    const separator = part.indexOf('=');
    return [part.slice(0, separator).trim(), decodeURIComponent(part.slice(separator + 1).trim())];
  }));
  next();
});

app.post('/api/auth/register-admin', rateLimit({ limit: 8 }), (request, response) => {
  const name = cleanText(request.body.name, 100);
  const email = cleanText(request.body.email, 254).toLowerCase();
  const password = request.body.password;
  const orgName = cleanText(request.body.orgName, 120);
  if (!name || !orgName || !validEmail(email) || typeof password !== 'string' || password.length < 12) {
    return response.status(400).json({ error: 'Enter your name, a valid email, an organization, and a password of at least 12 characters.' });
  }
  if (store.users.some(user => user.email === email)) {
    return response.status(409).json({ error: 'An account already exists for this email.' });
  }

  const user = {
    id: crypto.randomUUID(),
    name,
    email,
    ...passwordHash(password),
    role: 'ADMIN',
    orgName,
    status: 'ACTIVE',
    createdAt: new Date().toISOString()
  };
  store.users.push(user);
  writeStore();
  return response.status(201).json({ user: issueSession(response, user) });
});

app.post('/api/auth/login', rateLimit({ limit: 12 }), (request, response) => {
  const email = cleanText(request.body.email, 254).toLowerCase();
  const password = request.body.password;
  const user = store.users.find(item => item.email === email);
  if (!user || typeof password !== 'string' || !verifyPassword(password, user)) {
    return response.status(401).json({ error: 'Invalid email or password. Please try again.' });
  }
  return response.json({ user: issueSession(response, user, request.body.remember !== false) });
});

app.get('/api/auth/session', (request, response) => {
  const user = sessionUser(request);
  if (!user) return response.status(401).json({ error: 'No active session.' });
  return response.json({ user });
});

app.post('/api/super-admin/login/request-code', rateLimit({ limit: 5 }), async (request, response) => {
  const email = cleanText(request.body.email, 254).toLowerCase();
  const password = request.body.password;
  const user = store.users.find(item =>
    item.role === 'ADMIN' && item.email?.toLowerCase() === superAdminEmail
  );

  if (email !== superAdminEmail || !user || typeof password !== 'string' || !verifyPassword(password, user)) {
    return response.status(401).json({ error: 'The owner email or password is incorrect.' });
  }

  let transporter;
  try {
    transporter = createTransport();
  } catch (error) {
    logEmailFailure('Super Admin verification code could not be sent:', error);
    return response.status(503).json({ error: 'Owner sign-in email is not configured. Contact the platform administrator.' });
  }

  const code = crypto.randomInt(100_000, 1_000_000).toString();
  const { passwordHash: codeHash, passwordSalt: codeSalt } = passwordHash(code);
  const challenge = {
    id: crypto.randomBytes(32).toString('base64url'),
    userId: user.id,
    email: superAdminEmail,
    codeHash,
    codeSalt,
    attempts: 0,
    expiresAt: Date.now() + 10 * 60 * 1000
  };

  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM,
      to: superAdminEmail,
      subject: 'Your Tobs Circuit Super Admin sign-in code',
      text: `Your one-time Super Admin sign-in code is ${code}. It expires in 10 minutes. If you did not request this code, you can ignore this email.`,
      html: `<p>Your one-time Super Admin sign-in code is:</p><p style="font-size:28px;font-weight:bold;letter-spacing:6px">${code}</p><p>It expires in 10 minutes. If you did not request this code, you can ignore this email.</p>`
    });
  } catch (error) {
    logEmailFailure('Super Admin verification code could not be sent:', error);
    return response.status(503).json({ error: emailFailureMessage(error) });
  }

  store.superAdminChallenges = [
    ...store.superAdminChallenges.filter(item => item.expiresAt > Date.now() && item.userId !== user.id),
    challenge
  ];
  writeStore();
  return response.json({
    challengeId: challenge.id,
    message: `A one-time code was sent to ${superAdminEmail}.`
  });
});

app.post('/api/super-admin/login/verify-code', rateLimit({ limit: 10 }), (request, response) => {
  const challengeId = cleanText(request.body.challengeId, 128);
  const code = cleanText(request.body.code, 6);
  const challenge = store.superAdminChallenges.find(item => item.id === challengeId);

  if (!challenge || challenge.expiresAt <= Date.now() || !/^\d{6}$/.test(code)) {
    return response.status(401).json({ error: 'The sign-in code is invalid or expired. Request a new code.' });
  }

  challenge.attempts += 1;
  if (!verifyPassword(code, { passwordSalt: challenge.codeSalt, passwordHash: challenge.codeHash })) {
    if (challenge.attempts >= 5) {
      store.superAdminChallenges = store.superAdminChallenges.filter(item => item.id !== challenge.id);
    }
    writeStore();
    return response.status(401).json({ error: challenge.attempts >= 5
      ? 'Too many incorrect codes. Request a new sign-in code.'
      : 'The sign-in code is incorrect.' });
  }

  const user = store.users.find(item =>
    item.id === challenge.userId && item.role === 'ADMIN' && item.email?.toLowerCase() === superAdminEmail
  );
  store.superAdminChallenges = store.superAdminChallenges.filter(item => item.id !== challenge.id);
  if (!user) {
    writeStore();
    return response.status(401).json({ error: 'The owner account is no longer available.' });
  }

  return response.json({ user: issueSession(response, user, true, true) });
});

app.get('/api/super-admin/session', (request, response) => {
  const user = sessionUser(request);
  if (!user) return response.json({ status: 'signed-out' });
  if (!isSuperAdmin(user)) return response.json({ status: 'denied', user });

  const session = sessions.get(request.cookies?.[sessionCookie]);
  if (!session?.superAdminVerified) return response.json({ status: 'needs-verification', user });
  return response.json({ status: 'ready', user });
});

app.get('/api/super-admin/overview', requireUser, requireSuperAdmin, (request, response) => {
  const admins = store.users.filter(user => user.role === 'ADMIN');
  const drivers = store.users.filter(user => user.role === 'DRIVER');
  const adminById = new Map(admins.map(admin => [admin.id, admin]));
  const driverById = new Map(drivers.map(driver => [driver.id, driver]));

  const businesses = admins.map(admin => ({
    id: admin.id,
    name: admin.orgName || admin.name,
    administrator: admin.name,
    email: admin.email,
    status: admin.status || 'ACTIVE',
    createdAt: admin.createdAt || null,
    driverCount: drivers.filter(driver => driver.ownerAdminId === admin.id).length,
    deliveryCount: store.stops.filter(stop => stop.ownerAdminId === admin.id).length
  }));
  const safeDrivers = drivers.map(driver => ({
    id: driver.id,
    name: driver.name,
    email: driver.email,
    phone: driver.phone || '',
    businessName: driver.orgName || adminById.get(driver.ownerAdminId)?.orgName || 'Unknown business',
    status: driver.status || 'ACTIVE',
    routeStatus: driver.routeStatus || 'IDLE',
    isTracking: Boolean(driver.isTracking),
    lat: Number.isFinite(driver.lat) ? driver.lat : null,
    lng: Number.isFinite(driver.lng) ? driver.lng : null,
    locationUpdatedAt: driver.locationUpdatedAt || null,
    zone: driver.zone || '',
    vehicle: driver.vehicle || ''
  }));
  const deliveries = store.stops.map(stop => ({
    id: stop.id,
    name: stop.name,
    address: stop.address,
    businessName: adminById.get(stop.ownerAdminId)?.orgName || 'Unknown business',
    driverName: driverById.get(stop.assignedDriverId)?.name || 'Unassigned',
    status: stop.status || 'PENDING',
    priority: stop.priority || 'NORMAL',
    packages: Number.isFinite(stop.packages) ? stop.packages : 0,
    lat: Number.isFinite(stop.lat) ? stop.lat : null,
    lng: Number.isFinite(stop.lng) ? stop.lng : null,
    deliveredAt: stop.deliveredAt || null
  }));
  const invitations = store.invitations.map(invite => ({
    id: invite.id,
    email: invite.email || '',
    businessName: adminById.get(invite.ownerAdminId)?.orgName || invite.orgName || 'Unknown business',
    status: invite.status || 'PENDING',
    createdAt: invite.createdAt || null,
    registeredAt: invite.registeredAt || null
  }));

  return response.json({
    generatedAt: new Date().toISOString(),
    businesses,
    drivers: safeDrivers,
    deliveries,
    invitations,
    supportThreads: store.supportThreads
      .slice()
      .sort((left, right) => new Date(right.updatedAt || right.createdAt).getTime() - new Date(left.updatedAt || left.createdAt).getTime())
      .map(thread => ({
        id: thread.id,
        userId: thread.userId,
        userName: thread.userName,
        userRole: thread.userRole,
        caseId: thread.caseId,
        status: thread.status,
        assignedTo: thread.assignedTo || 'CUSTOMER_CARE',
        escalatedAt: thread.escalatedAt || null,
        updatedAt: thread.updatedAt || thread.createdAt,
        messages: (thread.messages || []).slice(-2)
      })),
    health: {
      status: 'OPERATIONAL',
      storage: usesDatabase ? 'PostgreSQL' : 'Local JSON',
      uptimeSeconds: Math.floor(process.uptime())
    }
  });
});

app.post('/api/auth/logout', (request, response) => {
  const token = request.cookies?.[sessionCookie];
  if (token) {
    sessions.delete(token);
    store.sessions = store.sessions.filter(session => session.token !== token);
    writeStore();
  }
  response.clearCookie(sessionCookie, {
    httpOnly: true,
    secure: isProduction,
    sameSite: frontendOrigin && isProduction ? 'none' : 'strict',
    path: '/'
  });
  return response.json({ ok: true });
});

app.post('/api/auth/password-reset', rateLimit({ limit: 5 }), async (request, response) => {
  const email = cleanText(request.body.email, 254).toLowerCase();
  if (!validEmail(email)) return response.status(400).json({ error: 'Enter a valid account email address.' });
  let transporter;
  try {
    transporter = createTransport();
  } catch (error) {
    logEmailFailure('Password reset email could not be sent:', error);
    return response.status(503).json({ error: 'Password recovery email is not configured. Please contact your fleet administrator.' });
  }

  const user = store.users.find(item => item.email === email);
  if (user) {
    const code = crypto.randomInt(10_000_000, 100_000_000).toString();
    const { passwordHash: codeHash, passwordSalt: codeSalt } = passwordHash(code);
    const previousResets = store.passwordResets;
    store.passwordResets = [
      ...previousResets.filter(item => item.userId !== user.id),
      {
        codeHash,
        codeSalt,
        userId: user.id,
        expiresAt: Date.now() + 15 * 60 * 1000
      }
    ];
    writeStore();
    try {
      await transporter.sendMail({
        from: process.env.SMTP_FROM,
        to: user.email,
        subject: 'Your Tobs Route Circuit password reset code',
        text: `Your password reset code is ${code}. Enter this one-time code in the password recovery form within 15 minutes. If you did not request a password reset, you can ignore this email.`,
        html: `<p>Your password reset code is:</p><p style="font-size:28px;font-weight:bold;letter-spacing:6px">${code}</p><p>Enter this one-time code in the password recovery form within 15 minutes.</p><p>If you did not request a password reset, you can ignore this email.</p>`
      });
    } catch (error) {
      store.passwordResets = previousResets;
      writeStore();
      logEmailFailure('Password reset email could not be sent:', error);
      return response.status(503).json({ error: emailFailureMessage(error) });
    }
  }
  return response.json({ message: 'If an account exists for that email, a recovery code has been sent. Check your inbox and spam folder.' });
});

app.post('/api/auth/password-reset/complete', rateLimit({ limit: 10 }), (request, response) => {
  const token = cleanText(request.body.token, 128);
  const code = cleanText(request.body.code, 8);
  const password = request.body.password;
  const reset = token
    ? store.passwordResets.find(item =>
      item.tokenHash === crypto.createHash('sha256').update(token).digest('hex') && item.expiresAt > Date.now()
    )
    : /^\d{8}$/.test(code)
      ? store.passwordResets.find(item =>
        item.codeSalt
        && item.codeHash
        && verifyPassword(code, { passwordSalt: item.codeSalt, passwordHash: item.codeHash })
        && item.expiresAt > Date.now()
      )
      : null;
  if (!reset) return response.status(400).json({ error: 'This password reset code is invalid or expired. Request a new one.' });
  if (typeof password !== 'string' || password.length < 12) {
    return response.status(400).json({ error: 'Choose a password with at least 12 characters.' });
  }
  const user = store.users.find(item => item.id === reset.userId);
  if (!user) return response.status(400).json({ error: 'This password reset code or link is invalid or expired. Request a new one.' });
  Object.assign(user, passwordHash(password));
  store.passwordResets = store.passwordResets.filter(item => item.userId !== user.id);
  for (const [sessionToken, session] of sessions) {
    if (session.userId === user.id) sessions.delete(sessionToken);
  }
  store.sessions = store.sessions.filter(session => session.userId !== user.id);
  writeStore();
  return response.json({ ok: true });
});

app.get('/api/invitations/:token', rateLimit({ limit: 30 }), (request, response) => {
  const invite = store.invitations.find(item => item.token === request.params.token && item.status === 'PENDING');
  if (!invite) return response.status(404).json({ error: 'This application link is invalid, expired, or already used.' });
  return response.json({ email: invite.email, orgName: invite.orgName });
});

app.post('/api/auth/register-driver', rateLimit({ limit: 10 }), (request, response) => {
  const name = cleanText(request.body.name, 100);
  const email = cleanText(request.body.email, 254).toLowerCase();
  const password = request.body.password;
  const token = cleanText(request.body.inviteToken, 128);
  const invite = store.invitations.find(item =>
    item.token === token &&
    item.status === 'PENDING' &&
    (!item.email || item.email === email)
  );
  if (!invite) {
    return response.status(400).json({ error: 'This link is invalid or has already been used. Use the invitation sent to your email.' });
  }
  const zone = cleanText(request.body.zone, 100);
  const vehicle = cleanText(request.body.vehicle, 100);
  if (!name || !validEmail(email) || typeof password !== 'string' || password.length < 12 || !zone || !vehicle) {
    return response.status(400).json({ error: 'Enter your name, valid email, password (at least 12 characters), operating zone, and vehicle plate number.' });
  }
  if (store.users.some(user => user.email === email)) {
    return response.status(409).json({ error: 'An account already exists for this email.' });
  }

  const user = {
    id: crypto.randomUUID(),
    name,
    email,
    ...passwordHash(password),
    role: 'DRIVER',
    orgName: invite.orgName,
    ownerAdminId: invite.ownerAdminId,
    zone,
    vehicle,
    phone: cleanText(request.body.phone, 40),
    status: 'ACTIVE',
    isTracking: false,
    routeStatus: 'IDLE',
    createdAt: new Date().toISOString()
  };
  invite.status = 'REGISTERED';
  invite.registeredAt = new Date().toISOString();
  store.users.push(user);
  writeStore();
  return response.status(201).json({ user: issueSession(response, user) });
});

app.get('/api/users', requireUser, (request, response) => {
  const ownerAdminId = request.user.role === 'ADMIN' ? request.user.id : request.user.ownerAdminId;
  const users = store.users.filter(user =>
    user.id === ownerAdminId || user.ownerAdminId === ownerAdminId
  );
  return response.json({ users: users.map(publicUser) });
});

app.get('/api/support/threads', requireUser, requireSupportAccess, (request, response) => {
  const visibleThreads = store.supportThreads.filter(thread => {
    if (request.user.role === 'CUSTOMER_CARE' || isSuperAdmin(request.user)) return true;
    return thread.userId === request.user.id;
  }).sort((left, right) => new Date(right.updatedAt || right.createdAt).getTime() - new Date(left.updatedAt || left.createdAt).getTime());

  response.json({
    threads: visibleThreads.map(thread => ({
      ...thread,
      messages: Array.isArray(thread.messages) ? thread.messages.slice(-12) : []
    }))
  });
});

app.post('/api/customer-care/threads/:id/reply', requireUser, requireCustomerCare, (request, response) => {
  const text = cleanText(request.body.text, 2000);
  if (!text) return response.status(400).json({ error: 'Write a reply before sending.' });

  const thread = store.supportThreads.find(item => item.id === request.params.id);
  if (!thread) return response.status(404).json({ error: 'Support case not found.' });

  const message = {
    id: crypto.randomUUID(),
    sender: 'CUSTOMER_CARE',
    senderName: request.user.name,
    text,
    createdAt: new Date().toISOString()
  };
  thread.messages = [...(thread.messages || []), message];
  thread.status = 'IN_PROGRESS';
  thread.assignedTo = request.user.email;
  thread.updatedAt = message.createdAt;
  delete thread.resolvedAt;
  writeStore();

  return response.json({ thread: { ...thread, messages: thread.messages.slice(-12) } });
});

app.patch('/api/customer-care/threads/:id', requireUser, requireCustomerCare, (request, response) => {
  const status = cleanText(request.body.status, 20);
  if (!['OPEN', 'IN_PROGRESS', 'RESOLVED'].includes(status)) {
    return response.status(400).json({ error: 'The support case status is invalid.' });
  }

  const thread = store.supportThreads.find(item => item.id === request.params.id);
  if (!thread) return response.status(404).json({ error: 'Support case not found.' });

  thread.status = status;
  thread.updatedAt = new Date().toISOString();
  if (status === 'RESOLVED') thread.resolvedAt = thread.updatedAt;
  else delete thread.resolvedAt;
  writeStore();

  return response.json({ thread: { ...thread, messages: (thread.messages || []).slice(-12) } });
});

app.post('/api/support/chat', requireUser, requireSupportAccess, (request, response) => {
  const message = cleanText(request.body.message, 2000);
  if (!message) return response.status(400).json({ error: 'Type a question or issue before sending.' });

  const threadId = cleanText(request.body.threadId, 128);
  let thread = threadId
    ? store.supportThreads.find(item => item.id === threadId && item.userId === request.user.id)
    : null;

  if (!thread) {
    thread = {
      id: `support-${crypto.randomUUID()}`,
      userId: request.user.id,
      userName: request.user.name,
      userRole: request.user.role,
      caseId: `CASE-${Date.now().toString().slice(-6)}`,
      status: 'OPEN',
      assignedTo: 'CUSTOMER_CARE',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: []
    };
    store.supportThreads.unshift(thread);
  }

  const userMessage = {
    id: crypto.randomUUID(),
    sender: 'USER',
    text: message,
    createdAt: new Date().toISOString()
  };
  if (thread.status === 'RESOLVED') thread.status = 'OPEN';
  thread.messages = [...(thread.messages || []), userMessage];

  const reply = buildSupportBotReply(message);
  if (reply.escalated || thread.status === 'ESCALATED') {
    thread.status = 'ESCALATED';
    thread.assignedTo = 'CUSTOMER_CARE';
    thread.escalatedAt = new Date().toISOString();
  }

  const botMessage = {
    id: crypto.randomUUID(),
    sender: 'BOT',
    text: reply.text,
    createdAt: new Date().toISOString(),
    escalated: reply.escalated
  };

  thread.messages = [...(thread.messages || []), botMessage];
  thread.updatedAt = new Date().toISOString();
  writeStore();

  return response.json({
    thread: {
      ...thread,
      messages: thread.messages.slice(-12)
    },
    reply: botMessage
  });
});

app.get('/api/super-admin/customer-care', requireUser, requireSupportAccess, (request, response) => {
  const visibleThreads = store.supportThreads.filter(thread =>
    request.user.role === 'CUSTOMER_CARE' || isSuperAdmin(request.user) || thread.userId === request.user.id
  ).sort((left, right) => new Date(right.updatedAt || right.createdAt).getTime() - new Date(left.updatedAt || left.createdAt).getTime());

  return response.json({
    threads: visibleThreads.map(thread => ({
      ...thread,
      messages: Array.isArray(thread.messages) ? thread.messages.slice(-12) : []
    }))
  });
});

app.post('/api/super-admin/customer-care', requireUser, rateLimit({ limit: 30 }), (request, response, next) => {
  const action = cleanText(request.body.action, 20);

  if (action === 'chat') {
    if (!['ADMIN', 'DRIVER'].includes(request.user.role)) {
      return response.status(403).json({ error: 'This account cannot start a Customer Care chat.' });
    }
    const message = cleanText(request.body.message, 2000);
    if (!message) return response.status(400).json({ error: 'Type a question or issue before sending.' });

    const threadId = cleanText(request.body.threadId, 128);
    let thread = threadId
      ? store.supportThreads.find(item => item.id === threadId && item.userId === request.user.id)
      : null;
    if (!thread) {
      thread = {
        id: `support-${crypto.randomUUID()}`,
        userId: request.user.id,
        userName: request.user.name,
        userRole: request.user.role,
        caseId: `CASE-${Date.now().toString().slice(-6)}`,
        status: 'OPEN',
        assignedTo: 'CUSTOMER_CARE',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messages: []
      };
      store.supportThreads.unshift(thread);
    }

    const userMessage = {
      id: crypto.randomUUID(),
      sender: 'USER',
      text: message,
      createdAt: new Date().toISOString()
    };
    if (thread.status === 'RESOLVED') thread.status = 'OPEN';
    thread.messages = [...(thread.messages || []), userMessage];

    const reply = buildSupportBotReply(message);
    if (reply.escalated || thread.status === 'ESCALATED') {
      thread.status = 'ESCALATED';
      thread.assignedTo = 'CUSTOMER_CARE';
      thread.escalatedAt = new Date().toISOString();
    }
    const botMessage = {
      id: crypto.randomUUID(),
      sender: 'BOT',
      text: reply.text,
      createdAt: new Date().toISOString(),
      escalated: reply.escalated
    };
    thread.messages = [...thread.messages, botMessage];
    thread.updatedAt = botMessage.createdAt;
    writeStore();

    return response.json({ thread: { ...thread, messages: thread.messages.slice(-12) }, reply: botMessage });
  }

  if (action === 'reply') {
    if (request.user.role !== 'CUSTOMER_CARE') {
      return response.status(403).json({ error: 'Only Customer Care accounts can reply to support cases.' });
    }
    const text = cleanText(request.body.text, 2000);
    if (!text) return response.status(400).json({ error: 'Write a reply before sending.' });
    const threadId = cleanText(request.body.threadId, 128);
    const thread = store.supportThreads.find(item => item.id === threadId);
    if (!thread) return response.status(404).json({ error: 'Support case not found.' });

    const reply = {
      id: crypto.randomUUID(),
      sender: 'CUSTOMER_CARE',
      senderName: request.user.name,
      text,
      createdAt: new Date().toISOString()
    };
    thread.messages = [...(thread.messages || []), reply];
    thread.status = 'IN_PROGRESS';
    thread.assignedTo = request.user.email;
    thread.updatedAt = reply.createdAt;
    delete thread.resolvedAt;
    writeStore();
    return response.json({ thread: { ...thread, messages: thread.messages.slice(-12) } });
  }

  return next();
});

app.patch('/api/super-admin/customer-care', requireUser, requireCustomerCare, (request, response) => {
  const threadId = cleanText(request.body.threadId, 128);
  const status = cleanText(request.body.status, 20);
  if (!['OPEN', 'IN_PROGRESS', 'RESOLVED'].includes(status)) {
    return response.status(400).json({ error: 'The support case status is invalid.' });
  }
  const thread = store.supportThreads.find(item => item.id === threadId);
  if (!thread) return response.status(404).json({ error: 'Support case not found.' });

  thread.status = status;
  thread.updatedAt = new Date().toISOString();
  if (status === 'RESOLVED') thread.resolvedAt = thread.updatedAt;
  else delete thread.resolvedAt;
  writeStore();
  return response.json({ thread: { ...thread, messages: (thread.messages || []).slice(-12) } });
});

app.post('/api/super-admin/customer-care', requireUser, requireSuperAdmin, rateLimit({ limit: 8 }), (request, response) => {
  const name = cleanText(request.body.name, 100) || 'Customer Care';
  const email = cleanText(request.body.email, 254).toLowerCase();
  const password = request.body.password;

  if (!validEmail(email)) {
    return response.status(400).json({ error: 'Enter a valid email address for the Customer Care account.' });
  }
  if (typeof password !== 'string' || password.length < 8) {
    return response.status(400).json({ error: 'Choose a temporary password with at least 8 characters.' });
  }
  if (store.users.some(user => user.email === email)) {
    return response.status(409).json({ error: 'An account already exists for that email.' });
  }

  const user = {
    id: crypto.randomUUID(),
    name,
    email,
    ...passwordHash(password),
    role: 'CUSTOMER_CARE',
    orgName: 'Customer Care',
    ownerAdminId: request.user.id,
    status: 'ACTIVE',
    createdAt: new Date().toISOString()
  };

  store.users.push(user);
  writeStore();
  return response.status(201).json({ user: publicUser(user) });
});

app.get('/api/stops', requireUser, (request, response) => {
  const ownerAdminId = request.user.role === 'ADMIN' ? request.user.id : request.user.ownerAdminId;
  const stops = store.stops.filter(stop =>
    stop.ownerAdminId === ownerAdminId &&
    (request.user.role === 'ADMIN' || stop.assignedDriverId === request.user.id)
  );
  return response.json({ stops });
});

app.put('/api/stops', requireUser, (request, response) => {
  const incomingStops = request.body.stops;
  if (!Array.isArray(incomingStops) || incomingStops.length > 500) {
    return response.status(400).json({ error: 'The route stop list is invalid.' });
  }
  const ownerAdminId = request.user.role === 'ADMIN' ? request.user.id : request.user.ownerAdminId;
  if (!ownerAdminId) return response.status(403).json({ error: 'This account has no fleet owner.' });

  const previousFleetStops = store.stops.filter(stop => stop.ownerAdminId === ownerAdminId);
  const otherStops = store.stops.filter(stop => stop.ownerAdminId !== ownerAdminId);
  const ownedDrivers = store.users.filter(user => user.role === 'DRIVER' && user.ownerAdminId === ownerAdminId);
  const allowedDriverIds = new Set(ownedDrivers.map(driver => driver.id));
  if (request.user.role === 'DRIVER') allowedDriverIds.add(request.user.id);

  const sanitizedStops = [];
  for (const stop of incomingStops) {
    if (!stop || typeof stop.id !== 'string' || typeof stop.name !== 'string'
      || typeof stop.address !== 'string' || typeof stop.status !== 'string') {
      return response.status(400).json({ error: 'A route stop is missing required fields.' });
    }
    if (stop.assignedDriverId && !allowedDriverIds.has(stop.assignedDriverId)) {
      return response.status(403).json({ error: 'A route cannot be assigned outside your fleet.' });
    }
    if (request.user.role === 'DRIVER' && stop.assignedDriverId !== request.user.id) {
      return response.status(403).json({ error: 'Drivers can only update their own route stops.' });
    }
    sanitizedStops.push({ ...stop, ownerAdminId });
  }

  if (request.user.role === 'DRIVER') {
    const adminStops = store.stops.filter(stop =>
      stop.ownerAdminId === ownerAdminId && stop.assignedDriverId !== request.user.id
    );
    store.stops = [...otherStops, ...adminStops, ...sanitizedStops];
  } else {
    store.stops = [...otherStops, ...sanitizedStops];
  }

  for (const driver of ownedDrivers) {
    const driverStops = store.stops.filter(stop =>
      stop.ownerAdminId === ownerAdminId && stop.assignedDriverId === driver.id
    );
    const previousDriverStopIds = new Set(previousFleetStops
      .filter(stop => stop.assignedDriverId === driver.id)
      .map(stop => stop.id));
    const routeAssignmentChanged = request.user.role === 'ADMIN'
      && (driverStops.length !== previousDriverStopIds.size
        || driverStops.some(stop => !previousDriverStopIds.has(stop.id)));
    const routeStopCount = driverStops.length;
    driver.routeStopCount = routeStopCount;
    if (routeStopCount > 0 && driver.routeStatus === 'IDLE') {
      driver.routeStatus = 'PENDING';
      driver.routeUpdatedAt = new Date().toISOString();
    } else if (routeStopCount === 0 && driver.routeStatus !== 'IDLE') {
      driver.routeStatus = 'IDLE';
      driver.routeUpdatedAt = new Date().toISOString();
    } else if (routeStopCount > 0 && routeAssignmentChanged) {
      driver.routeStatus = 'PENDING';
      driver.routeUpdatedAt = new Date().toISOString();
    }
  }
  writeStore();
  const users = store.users.filter(user =>
    user.id === ownerAdminId || user.ownerAdminId === ownerAdminId
  );
  return response.json({ stops: sanitizedStops, users: users.map(publicUser) });
});

app.patch('/api/users/me/location', requireUser, (request, response) => {
  if (request.user.role !== 'DRIVER') {
    return response.status(403).json({ error: 'Only driver accounts can share live location.' });
  }
  const { lat, lng, speed, isTracking } = request.body;
  if (typeof isTracking !== 'boolean'
    || (isTracking && (!Number.isFinite(lat) || lat < -90 || lat > 90
      || !Number.isFinite(lng) || lng < -180 || lng > 180
      || !Number.isFinite(speed) || speed < 0 || speed > 300))) {
    return response.status(400).json({ error: 'The location update is invalid.' });
  }
  const user = store.users.find(item => item.id === request.user.id);
  user.isTracking = isTracking;
  user.locationUpdatedAt = isTracking ? new Date().toISOString() : null;
  if (isTracking) Object.assign(user, { lat, lng, speed });
  else {
    user.lat = null;
    user.lng = null;
    user.speed = 0;
  }
  writeStore();
  return response.json({ user: publicUser(user) });
});

app.patch('/api/users/:id/route-status', requireUser, (request, response) => {
  const statuses = ['IDLE', 'PENDING', 'ACCEPTED', 'IN_PROGRESS'];
  const { routeStatus, routeStopCount } = request.body;
  if (!statuses.includes(routeStatus)) {
    return response.status(400).json({ error: 'The route status is invalid.' });
  }
  const driver = store.users.find(item => item.id === request.params.id && item.role === 'DRIVER');
  if (!driver) return response.status(404).json({ error: 'Driver not found.' });
  const isOwnerAdmin = request.user.role === 'ADMIN' && driver.ownerAdminId === request.user.id;
  const isDriverSelf = request.user.role === 'DRIVER' && driver.id === request.user.id;
  if (!isOwnerAdmin && !isDriverSelf) {
    return response.status(403).json({ error: 'You do not manage this driver account.' });
  }
  if ((isOwnerAdmin && !['IDLE', 'PENDING'].includes(routeStatus))
    || (isDriverSelf && !['IDLE', 'ACCEPTED', 'IN_PROGRESS'].includes(routeStatus))) {
    return response.status(403).json({ error: 'You cannot set this route status.' });
  }
  driver.routeStatus = routeStatus;
  driver.routeUpdatedAt = new Date().toISOString();
  if (Number.isInteger(routeStopCount) && routeStopCount >= 0 && routeStopCount <= 500) {
    driver.routeStopCount = routeStopCount;
  }
  writeStore();
  return response.json({ user: publicUser(driver) });
});

app.delete('/api/users/:id', requireUser, requireAdmin, (request, response) => {
  const driver = store.users.find(user =>
    user.id === request.params.id &&
    user.role === 'DRIVER' &&
    user.ownerAdminId === request.user.id
  );
  if (!driver) return response.status(404).json({ error: 'Driver not found in your fleet.' });
  store.users = store.users.filter(user => user.id !== driver.id);
  writeStore();
  return response.json({ ok: true });
});

app.get('/api/invitations', requireUser, requireAdmin, (request, response) => {
  const invitations = store.invitations
    .filter(invite => invite.ownerAdminId === request.user.id)
    .map(invite => {
      const baseUrl = process.env.APP_BASE_URL || 'http://localhost:5173/Tobs-circuit/';
      const url = new URL(baseUrl);
      url.search = '';
      url.hash = '';
      url.searchParams.set('invite', invite.token);
      return { ...invite, applicationUrl: url.toString() };
    });
  return response.json({ invitations });
});

app.post('/api/invitations', requireUser, requireAdmin, rateLimit({ limit: 10 }), async (request, response) => {
  const email = cleanText(request.body.email, 254).toLowerCase();
  if (email && !validEmail(email)) return response.status(400).json({ error: 'Enter a valid driver email address or leave it blank.' });
  if (email && store.users.some(user => user.email === email)) {
    return response.status(409).json({ error: 'An account already exists for this email.' });
  }
  if (!process.env.APP_BASE_URL && isProduction) {
    return response.status(503).json({ error: 'Set APP_BASE_URL on the server before sending invitations.' });
  }

  const token = crypto.randomBytes(32).toString('base64url');
  const baseUrl = process.env.APP_BASE_URL || 'http://localhost:5173/Tobs-circuit/';
  let applicationUrl;
  try {
    const url = new URL(baseUrl);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Invalid application URL protocol.');
    url.search = '';
    url.hash = '';
    url.searchParams.set('invite', token);
    applicationUrl = url.toString();
  } catch (error) {
    console.error('Invalid APP_BASE_URL setting:', error);
    return response.status(503).json({ error: 'The application URL is not configured correctly on the server.' });
  }

  const invite = {
    id: crypto.randomUUID(),
    token,
    email,
    orgName: request.user.orgName,
    ownerAdminId: request.user.id,
    createdAt: new Date().toISOString(),
    status: 'PENDING'
  };
  let sent = false;
  let emailWarning = '';
  if (email) {
    if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASSWORD || !process.env.SMTP_FROM) {
      emailWarning = 'Email is not configured. Add the SMTP settings in Render; you can copy and share the application link meanwhile.';
    } else {
      try {
        const transporter = createTransport();
        const organization = escapeHtml(request.user.orgName);
        const safeApplicationUrl = escapeHtml(applicationUrl);
        await transporter.sendMail({
          from: process.env.SMTP_FROM,
          to: email,
          subject: `Apply to drive with ${request.user.orgName}`,
          text: `You have been invited to apply as a driver with ${request.user.orgName}.\n\nComplete your application using this personal link:\n${applicationUrl}\n\nThis link is intended for ${email}.`,
          html: `<p>You have been invited to apply as a driver with <strong>${organization}</strong>.</p><p><a href="${safeApplicationUrl}">Open your driver application</a></p><p>This personal link is intended for ${escapeHtml(email)}.</p>`
        });
        sent = true;
      } catch (error) {
        logEmailFailure('Invitation email could not be sent:', error);
        emailWarning = `${emailFailureMessage(error)} The application link was created; copy and share it as a backup.`;
      }
    }
  }
  store.invitations = store.invitations.filter(item =>
    !(email && item.ownerAdminId === request.user.id && item.email === email && item.status === 'PENDING')
  );
  store.invitations.unshift(invite);
  writeStore();
  return response.status(201).json({ invite: { ...invite, applicationUrl }, sent, emailWarning });
});

app.use('/api', (request, response) => response.status(404).json({ error: 'API route not found.' }));
const distributionDirectory = path.join(__dirname, 'dist');
app.use(express.static(distributionDirectory));
app.use('/Tobs-circuit', express.static(distributionDirectory));
app.use((request, response, next) => {
  if (request.method !== 'GET' || request.path.startsWith('/api/')) return next();
  return response.sendFile(path.join(distributionDirectory, 'index.html'));
});

export default app;

if (!process.env.VERCEL) {
  app.listen(port, '0.0.0.0', () => {
    console.log(`Tobs Route Circuit server listening on port ${port}.`);
  });
}
