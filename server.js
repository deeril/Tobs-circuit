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
const usesDatabase = Boolean(process.env.VERCEL || databaseUrl);
const databasePool = usesDatabase && databaseUrl
  ? new pg.Pool({ connectionString: databaseUrl, max: 1, idleTimeoutMillis: 10_000 })
  : null;
const sessionCookie = 'tobs_session';
const sessions = new Map();
const rateLimits = new Map();
const frontendOrigin = process.env.FRONTEND_ORIGIN || '';

if (!usesDatabase) fs.mkdirSync(dataDirectory, { recursive: true });

let databaseSetupPromise;
let databaseRequestClient = null;
let databaseStoreDirty = false;

function readStore() {
  if (!fs.existsSync(dataFile)) return { users: [], invitations: [], passwordResets: [], stops: [], sessions: [] };
  const parsed = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  return {
    users: Array.isArray(parsed.users) ? parsed.users : [],
    invitations: Array.isArray(parsed.invitations) ? parsed.invitations : [],
    passwordResets: Array.isArray(parsed.passwordResets) ? parsed.passwordResets : [],
    stops: Array.isArray(parsed.stops) ? parsed.stops : [],
    sessions: Array.isArray(parsed.sessions) ? parsed.sessions : []
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
      expiresAt: session.expiresAt
    });
  }
  store.sessions = store.sessions.filter(session => session.expiresAt > Date.now());
}

async function ensureDatabaseTable() {
  if (!databasePool) throw new Error('Set DATABASE_URL in the Vercel project environment to connect the Neon database.');
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
    sessions: Array.isArray(state.sessions) ? state.sessions : []
  };
  restoreStoredSessions();
}

function persistentApiState(request, response, next) {
  if (!usesDatabase) return next();
  if (!databasePool) {
    return response.status(503).json({ error: 'The Vercel database connection is missing. Set DATABASE_URL to the Neon connection string in project settings.' });
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
        response.status(503).json({ error: 'The account database could not be reached. Check the Neon connection settings and try again.' });
      }
    })
    .catch(error => {
      console.error('Could not connect to the account database:', error);
      response.status(503).json({ error: 'The account database could not be reached. Check the Neon connection settings and try again.' });
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

function cleanText(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function issueSession(response, user, remember = true) {
  const token = crypto.randomBytes(32).toString('base64url');
  const session = { userId: user.id, expiresAt: Date.now() + 12 * 60 * 60 * 1000 };
  sessions.set(token, session);
  store.sessions = [...store.sessions.filter(item => item.token !== token), { token, ...session }];
  writeStore();
  setSessionCookie(response, token, remember);
  return publicUser(user);
}

function createTransport() {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const password = process.env.SMTP_PASSWORD;
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
  response.json({ ok: true, storage: usesDatabase ? 'neon-postgres' : 'local-json' });
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
  const user = store.users.find(item => item.email === email);
  if (user) {
    try {
      if (!process.env.APP_BASE_URL) throw new Error('APP_BASE_URL is not configured.');
      const baseUrl = new URL(process.env.APP_BASE_URL);
      baseUrl.search = '';
      baseUrl.hash = '';
      const token = crypto.randomBytes(32).toString('base64url');
      baseUrl.searchParams.set('reset', token);
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      const transporter = createTransport();
      const previousResets = store.passwordResets;
      store.passwordResets = [
        ...previousResets.filter(item => item.userId !== user.id),
        {
          tokenHash,
          userId: user.id,
          expiresAt: Date.now() + 30 * 60 * 1000
        }
      ];
      writeStore();
      try {
        await transporter.sendMail({
          from: process.env.SMTP_FROM,
          to: user.email,
          subject: 'Reset your Tobs Route Circuit password',
          text: `Use this one-time link to reset your password. It expires in 30 minutes:\n${baseUrl.toString()}`,
          html: `<p>Use this one-time link to reset your password. It expires in 30 minutes:</p><p><a href="${escapeHtml(baseUrl.toString())}">Reset password</a></p>`
        });
      } catch (error) {
        store.passwordResets = previousResets;
        writeStore();
        throw error;
      }
    } catch (error) {
      console.error('Password reset email could not be sent:', error);
    }
  }
  return response.json({ message: 'If an account exists for that email, a password reset link has been sent. Contact your fleet administrator if it does not arrive.' });
});

app.post('/api/auth/password-reset/complete', rateLimit({ limit: 10 }), (request, response) => {
  const token = cleanText(request.body.token, 128);
  const password = request.body.password;
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const reset = store.passwordResets.find(item =>
    item.tokenHash === tokenHash && item.expiresAt > Date.now()
  );
  if (!reset) return response.status(400).json({ error: 'This password reset link is invalid or expired. Request a new one.' });
  if (typeof password !== 'string' || password.length < 12) {
    return response.status(400).json({ error: 'Choose a password with at least 12 characters.' });
  }
  const user = store.users.find(item => item.id === reset.userId);
  if (!user) return response.status(400).json({ error: 'This password reset link is invalid or expired. Request a new one.' });
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
    lat: 6.5244,
    lng: 3.3792,
    speed: 0,
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
    const routeStopCount = store.stops.filter(stop =>
      stop.ownerAdminId === ownerAdminId && stop.assignedDriverId === driver.id
    ).length;
    driver.routeStopCount = routeStopCount;
    if (routeStopCount > 0 && driver.routeStatus === 'IDLE') {
      driver.routeStatus = 'PENDING';
      driver.routeUpdatedAt = new Date().toISOString();
    } else if (routeStopCount === 0 && driver.routeStatus !== 'IDLE') {
      driver.routeStatus = 'IDLE';
      driver.routeUpdatedAt = new Date().toISOString();
    }
  }
  writeStore();
  return response.json({ stops: sanitizedStops });
});

app.patch('/api/users/me/location', requireUser, (request, response) => {
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
  else user.speed = 0;
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
  if (email && process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASSWORD && process.env.SMTP_FROM) {
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
      console.error('Invitation email could not be sent:', error);
      emailWarning = 'The application link was created, but the email could not be sent. Copy and share the link instead.';
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
