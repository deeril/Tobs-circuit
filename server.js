import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createServer } from 'node:http';
import nodemailer from 'nodemailer';
import pg from 'pg';
import { Server } from 'socket.io';
import {
  cellsWithinRadius,
  isWithinSearchCells,
  RIDER_DISCOVERY_RADIUS_ROUNDS_KM
} from './src/dispatch-geo.js';
import { getRoadRoute, searchPhoton } from './server/dispatch-services.js';
import { AUTHORIZED_MAP_RIDERS_SQL } from './server/dispatch-map-query.js';
import { hasActiveRiderAssignment } from './server/dispatch-assignments.js';
import { PUBLIC_MARKETPLACE_DRIVERS_SQL } from './server/dispatch-marketplace-query.js';
import { estimateDeliveryPrice, validatePricingRules } from './server/pricing.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const httpServer = createServer(app);
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
const frontendOrigins = [
  frontendOrigin,
  process.env.RENDER_EXTERNAL_URL,
  process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:3000',
  'http://127.0.0.1:3000'
].filter(Boolean);
const io = new Server(httpServer, {
  cors: {
    origin: frontendOrigins,
    credentials: true,
    methods: ['GET', 'POST']
  }
});

io.use((socket, next) => {
  const origin = socket.handshake.headers.origin;
  const forwardedProtocol = socket.handshake.headers['x-forwarded-proto']?.split(',')[0].trim();
  const requestProtocol = forwardedProtocol || (socket.request.socket.encrypted ? 'https' : 'http');
  const requestOrigin = `${requestProtocol}://${socket.handshake.headers.host}`;
  if (origin && !frontendOrigins.includes(origin) && origin !== requestOrigin) {
    next(new Error('This origin is not allowed to connect to live updates.'));
    return;
  }

  const cookie = socket.handshake.headers.cookie
    ?.split(';')
    .map(part => part.trim())
    .find(part => part.startsWith(`${sessionCookie}=`));
  const token = cookie ? decodeURIComponent(cookie.slice(sessionCookie.length + 1)) : '';
  const session = sessions.get(token);
  const user = session && session.expiresAt > Date.now()
    ? store.users.find(item => item.id === session.userId)
    : null;
  if (!user || !['ADMIN', 'DRIVER'].includes(user.role)
    || (user.role === 'DRIVER' && user.status !== 'ACTIVE')) {
    next(new Error('Sign in to receive live dispatch updates.'));
    return;
  }

  socket.data.userId = user.id;
  socket.data.userRole = user.role;
  socket.data.superAdminVerified = session.superAdminVerified === true;
  socket.data.isSuperAdmin = isSuperAdmin(user);
  socket.data.businessId = user.role === 'ADMIN' ? user.id : user.ownerAdminId;
  next();
});

io.on('connection', socket => {
  if (!socket.data.isSuperAdmin || socket.data.superAdminVerified) {
    socket.join(`user:${socket.data.userId}`);
  }
  if (socket.data.userRole === 'ADMIN') {
    socket.join(`business:${socket.data.userId}`);
    socket.join('marketplace:businesses');
  } else {
    socket.join(`driver:${socket.data.userId}`);
  }

  socket.on('dispatch:call:signal', async (payload, acknowledge = () => {}) => {
    const callId = typeof payload?.callId === 'string' ? payload.callId : '';
    const type = payload?.type;
    const data = payload?.data;
    const isDescription = ['offer', 'answer'].includes(type)
      && data && typeof data.sdp === 'string' && data.sdp.length <= 32_000
      && data.type === type;
    const isCandidate = type === 'ice'
      && data && typeof data.candidate === 'string' && data.candidate.length <= 4_096
      && (data.sdpMid == null || (typeof data.sdpMid === 'string' && data.sdpMid.length <= 64))
      && (data.sdpMLineIndex == null || Number.isInteger(data.sdpMLineIndex));
    if (!databasePool || !/^[0-9a-f-]{36}$/i.test(callId) || (!isDescription && !isCandidate)
      || (socket.data.isSuperAdmin && !socket.data.superAdminVerified)) {
      acknowledge({ ok: false, error: 'Invalid call signal.' });
      return;
    }

    try {
      const { rows } = await databasePool.query(`
        SELECT caller_id, recipient_id
        FROM dispatch_calls
        WHERE call_id = $1 AND status = 'ACCEPTED'
          AND $2 IN (caller_id, recipient_id)
      `, [callId, socket.data.userId]);
      if (!rows.length) {
        acknowledge({ ok: false, error: 'This call is not available to your account.' });
        return;
      }
      const peerId = rows[0].caller_id === socket.data.userId
        ? rows[0].recipient_id
        : rows[0].caller_id;
      const signalData = isDescription
        ? { type: data.type, sdp: data.sdp }
        : {
          candidate: data.candidate,
          ...(typeof data.sdpMid === 'string' ? { sdpMid: data.sdpMid } : {}),
          ...(Number.isInteger(data.sdpMLineIndex) ? { sdpMLineIndex: data.sdpMLineIndex } : {}),
          ...(typeof data.usernameFragment === 'string' ? { usernameFragment: data.usernameFragment.slice(0, 256) } : {})
        };
      io.to(`user:${peerId}`).emit('dispatch:call:signal', {
        callId,
        type,
        data: signalData,
        senderId: socket.data.userId
      });
      acknowledge({ ok: true });
    } catch (error) {
      console.error('Could not relay an authorized call signal:', error);
      acknowledge({ ok: false, error: 'Call signaling is temporarily unavailable.' });
    }
  });
});

if (!usesDatabase) fs.mkdirSync(dataDirectory, { recursive: true });

let databaseSetupPromise;
let databaseRequestClient = null;
let databaseStoreDirty = false;

function readStore() {
  if (!fs.existsSync(dataFile)) return {
    users: [], invitations: [], passwordResets: [], stops: [], sessions: [],
    supportThreads: [], superAdminChallenges: [], deliveryOffers: [], deliveryAssignments: []
  };
  const parsed = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  return {
    users: Array.isArray(parsed.users) ? parsed.users : [],
    invitations: Array.isArray(parsed.invitations) ? parsed.invitations : [],
    passwordResets: Array.isArray(parsed.passwordResets) ? parsed.passwordResets : [],
    stops: Array.isArray(parsed.stops) ? parsed.stops : [],
    sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
    supportThreads: Array.isArray(parsed.supportThreads) ? parsed.supportThreads : [],
    superAdminChallenges: Array.isArray(parsed.superAdminChallenges) ? parsed.superAdminChallenges : [],
    deliveryOffers: Array.isArray(parsed.deliveryOffers) ? parsed.deliveryOffers : [],
    deliveryAssignments: Array.isArray(parsed.deliveryAssignments) ? parsed.deliveryAssignments : []
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
      superAdminVerified: session.superAdminVerified === true,
      csrfToken: session.csrfToken || ''
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
      VALUES (1, '{"users":[],"invitations":[],"passwordResets":[],"stops":[],"sessions":[],"deliveryOffers":[]}'::jsonb)
      ON CONFLICT (id) DO NOTHING
    `)).then(() => databasePool.query(`
      CREATE TABLE IF NOT EXISTS tobs_delivery_assignments (
        delivery_id TEXT PRIMARY KEY,
        offer_id TEXT NOT NULL,
        owner_admin_id TEXT NOT NULL,
        rider_id TEXT NOT NULL,
        accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)).catch(error => {
      databaseSetupPromise = null;
      throw error;
    });
  }
  await databaseSetupPromise;
}

async function loadDatabaseStore(client, { lock = true } = {}) {
  await client.query('BEGIN');
  const { rows } = await client.query(
    `SELECT state FROM tobs_app_state WHERE id = 1${lock ? ' FOR UPDATE' : ''}`
  );
  const state = rows[0]?.state;
  if (!state || typeof state !== 'object') throw new Error('The persistent application data is invalid.');
  store = {
    users: Array.isArray(state.users) ? state.users : [],
    invitations: Array.isArray(state.invitations) ? state.invitations : [],
    passwordResets: Array.isArray(state.passwordResets) ? state.passwordResets : [],
    stops: Array.isArray(state.stops) ? state.stops : [],
    sessions: Array.isArray(state.sessions) ? state.sessions : [],
    supportThreads: Array.isArray(state.supportThreads) ? state.supportThreads : [],
    superAdminChallenges: Array.isArray(state.superAdminChallenges) ? state.superAdminChallenges : [],
    deliveryOffers: Array.isArray(state.deliveryOffers) ? state.deliveryOffers : [],
    deliveryAssignments: Array.isArray(state.deliveryAssignments) ? state.deliveryAssignments : []
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
        const readOnlyRequest = request.method === 'GET' && request.path !== '/auth/csrf';
        await loadDatabaseStore(client, { lock: !readOnlyRequest });
        const dispatchSchema = await client.query(`
          SELECT to_regclass('public.dispatch_deliveries') IS NOT NULL
            AND to_regclass('public.dispatch_offers') IS NOT NULL
            AND to_regclass('public.delivery_assignments') IS NOT NULL
            AND to_regclass('public.delivery_batch_offers') IS NOT NULL
            AND to_regclass('public.delivery_messages') IS NOT NULL
            AND to_regclass('public.platform_pricing_rules') IS NOT NULL AS ready,
              to_regclass('public.dispatch_calls') IS NOT NULL AS calls_ready
        `);
        request.dispatchSchemaReady = dispatchSchema.rows[0]?.ready === true;
        request.dispatchCallsReady = dispatchSchema.rows[0]?.calls_ready === true;
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

function publicUserForViewer(user, viewer) {
  const safeUser = publicUser(user);
  if (user.id === viewer.id) return safeUser;

  const hasActiveDelivery = viewer.role === 'ADMIN'
    && user.role === 'DRIVER'
    && store.stops.some(stop =>
      stop.ownerAdminId === viewer.id
      && stop.assignedDriverId === user.id
      && ['RIDER_ACCEPTED', 'HEADING_TO_PICKUP', 'ARRIVED_AT_PICKUP', 'HEADING_TO_DESTINATION']
        .includes(stop.dispatchStatus)
    );
  if (!hasActiveDelivery) {
    delete safeUser.phone;
    delete safeUser.lat;
    delete safeUser.lng;
    delete safeUser.speed;
    delete safeUser.locationUpdatedAt;
    safeUser.isTracking = false;
  }
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
  if (!user || (user.role === 'DRIVER' && user.status !== 'ACTIVE')) return null;
  return publicUser(user);
}

function safeEqualText(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string' || left.length !== right.length) return false;
  return crypto.timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

function isAllowedBrowserOrigin(request) {
  const origin = request.get('origin');
  const referer = request.get('referer');
  let sourceOrigin = origin;
  if (!sourceOrigin && referer) {
    try {
      sourceOrigin = new URL(referer).origin;
    } catch {
      return false;
    }
  }
  if (!sourceOrigin) return true;

  const allowedOrigins = new Set([frontendOrigin].filter(Boolean));
  if (request.get('host')) {
    const protocol = request.get('x-forwarded-proto')?.split(',')[0].trim() || request.protocol;
    allowedOrigins.add(`${protocol}://${request.get('host')}`);
  }
  if (allowedOrigins.has(sourceOrigin)) return true;
  if (!isProduction) {
    try {
      const { hostname, protocol } = new URL(sourceOrigin);
      return ['http:', 'https:'].includes(protocol)
        && ['localhost', '127.0.0.1', '[::1]'].includes(hostname);
    } catch {
      return false;
    }
  }
  return false;
}

function csrfProtection(request, response, next) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) return next();
  if (!isAllowedBrowserOrigin(request)) {
    return response.status(403).json({ error: 'This request origin is not allowed.' });
  }
  const user = sessionUser(request);
  if (!user) return next();
  const token = request.get('x-csrf-token');
  const session = sessions.get(request.cookies?.[sessionCookie]);
  if (!session?.csrfToken || !safeEqualText(token, session.csrfToken)) {
    return response.status(403).json({ error: 'Your security token is missing or expired. Refresh the page and try again.' });
  }
  return next();
}

function requireUser(request, response, next) {
  const user = sessionUser(request);
  if (!user) return response.status(401).json({ error: 'Please sign in to continue.' });
  if (user.role === 'DRIVER' && user.status !== 'ACTIVE') {
    return response.status(403).json({ error: 'Your driver account is awaiting approval or is no longer active.' });
  }
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

function validCoordinates(lat, lng) {
  return Number.isFinite(lat) && lat >= -90 && lat <= 90
    && Number.isFinite(lng) && lng >= -180 && lng <= 180;
}

function pricingQuoteSecret() {
  const configured = process.env.PRICING_QUOTE_SECRET || databaseUrl;
  if (configured) return configured;
  if (isProduction) throw new Error('Pricing quote signing is not configured.');
  return 'local-development-pricing-quote-key';
}

function signPricingQuote(payload) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', pricingQuoteSecret()).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

function verifyPricingQuote(token, businessId) {
  if (typeof token !== 'string' || token.length > 2048) return null;
  const [encoded, signature, ...rest] = token.split('.');
  if (!encoded || !signature || rest.length) return null;
  let expected;
  try {
    expected = crypto.createHmac('sha256', pricingQuoteSecret()).update(encoded).digest('base64url');
  } catch (error) {
    console.error('Pricing quote signature is not configured:', error.message);
    return null;
  }
  if (!safeEqualText(signature, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (payload.businessId !== businessId || !Number.isFinite(payload.expiresAt)
      || payload.expiresAt <= Date.now() || !Number.isFinite(payload.price)
      || !Number.isFinite(payload.distanceKm) || !Number.isFinite(payload.durationMinutes)
      || !Number.isInteger(payload.ruleVersion)) return null;
    return payload;
  } catch {
    return null;
  }
}

export { signPricingQuote, verifyPricingQuote };

function distanceInKilometers(from, to) {
  const radians = value => value * (Math.PI / 180);
  const latitudeDelta = radians(to.lat - from.lat);
  const longitudeDelta = radians(to.lng - from.lng);
  const arc = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(from.lat)) * Math.cos(radians(to.lat))
    * Math.sin(longitudeDelta / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(arc), Math.sqrt(1 - arc));
}

function dispatchStatusFromStop(stop) {
  const statuses = new Set([
    'UNASSIGNED', 'FINDING_RIDER', 'RIDER_ASSIGNED', 'RIDER_ACCEPTED',
    'HEADING_TO_PICKUP', 'ARRIVED_AT_PICKUP', 'HEADING_TO_DESTINATION',
    'DELIVERED', 'FAILED', 'CANCELLED'
  ]);
  if (statuses.has(stop.dispatchStatus)) return stop.dispatchStatus;
  if (stop.status === 'DELIVERED') return 'DELIVERED';
  return stop.assignedDriverId ? 'RIDER_ASSIGNED' : 'UNASSIGNED';
}

async function notifyDeliveryParticipants(client, deliveryId, notificationType, payload = {}) {
  const { rows } = await client.query(`
    SELECT delivery.business_id, assignment.rider_id
    FROM dispatch_deliveries AS delivery
    LEFT JOIN delivery_assignments AS assignment
      ON assignment.delivery_id = delivery.delivery_id
     AND assignment.business_id = delivery.business_id
     AND assignment.status = 'ACTIVE'
    WHERE delivery.delivery_id = $1
  `, [deliveryId]);
  const recipients = new Set(rows.flatMap(row =>
    [row.business_id, row.rider_id].filter(Boolean)
  ));
  for (const recipientId of recipients) {
    await client.query(`
      INSERT INTO dispatch_notifications
        (notification_id, recipient_id, delivery_id, notification_type, payload)
      VALUES ($1, $2, $3, $4, $5::jsonb)
    `, [crypto.randomUUID(), recipientId, deliveryId, notificationType, JSON.stringify(payload)]);
  }
}

async function syncDispatchDelivery(client, stop) {
  await client.query(`
    INSERT INTO dispatch_deliveries (
      delivery_id, business_id, status, zone_id, pickup_address, pickup_lat, pickup_lng,
      destination_address, destination_lat, destination_lng, package_count,
      package_description, package_size, package_weight_kg, required_vehicle_type,
      rider_earnings_ngn, deadline_at, estimated_price_ngn,
      pricing_rule_version, route_distance_km, route_duration_minutes, updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
      $18, $19, $20, $21, NOW())
    ON CONFLICT (delivery_id) DO UPDATE SET
      status = EXCLUDED.status,
      zone_id = EXCLUDED.zone_id,
      pickup_address = EXCLUDED.pickup_address,
      pickup_lat = EXCLUDED.pickup_lat,
      pickup_lng = EXCLUDED.pickup_lng,
      destination_address = EXCLUDED.destination_address,
      destination_lat = EXCLUDED.destination_lat,
      destination_lng = EXCLUDED.destination_lng,
      package_count = EXCLUDED.package_count,
      package_description = EXCLUDED.package_description,
      package_size = EXCLUDED.package_size,
      package_weight_kg = EXCLUDED.package_weight_kg,
      required_vehicle_type = EXCLUDED.required_vehicle_type,
      rider_earnings_ngn = EXCLUDED.rider_earnings_ngn,
      deadline_at = EXCLUDED.deadline_at,
      estimated_price_ngn = EXCLUDED.estimated_price_ngn,
      pricing_rule_version = EXCLUDED.pricing_rule_version,
      route_distance_km = EXCLUDED.route_distance_km,
      route_duration_minutes = EXCLUDED.route_duration_minutes,
      updated_at = NOW()
  `, [
    stop.id,
    stop.ownerAdminId,
    dispatchStatusFromStop(stop),
    stop.zoneId || null,
    stop.pickupAddress || '',
    validCoordinates(stop.pickupLat, stop.pickupLng) ? stop.pickupLat : null,
    validCoordinates(stop.pickupLat, stop.pickupLng) ? stop.pickupLng : null,
    stop.address || '',
    validCoordinates(stop.lat, stop.lng) ? stop.lat : null,
    validCoordinates(stop.lat, stop.lng) ? stop.lng : null,
    Number.isInteger(stop.packages) && stop.packages > 0 ? stop.packages : 1,
    stop.packageDescription || '',
    stop.packageSize || null,
    Number.isFinite(stop.packageWeightKg) && stop.packageWeightKg > 0 ? stop.packageWeightKg : null,
    stop.requiredVehicleType || null,
    Number.isFinite(stop.riderEarningsNgn) && stop.riderEarningsNgn >= 0 ? stop.riderEarningsNgn : null,
    stop.deliveryDeadlineAt && Number.isFinite(new Date(stop.deliveryDeadlineAt).getTime())
      ? new Date(stop.deliveryDeadlineAt).toISOString()
      : null,
    Number.isFinite(stop.estimatedPriceNgn) && stop.estimatedPriceNgn >= 0 ? stop.estimatedPriceNgn : null,
    Number.isInteger(stop.pricingRuleVersion) && stop.pricingRuleVersion > 0 ? stop.pricingRuleVersion : null,
    Number.isFinite(stop.routeDistanceKm) && stop.routeDistanceKm >= 0 ? stop.routeDistanceKm : null,
    Number.isInteger(stop.routeDurationMinutes) && stop.routeDurationMinutes > 0 ? stop.routeDurationMinutes : null
  ]);
  const status = dispatchStatusFromStop(stop);
  const { rows: latestStatuses } = await client.query(`
    SELECT status FROM delivery_status_history
    WHERE delivery_id = $1
    ORDER BY occurred_at DESC, event_id DESC
    LIMIT 1
  `, [stop.id]);
  if (latestStatuses[0]?.status !== status) {
    await client.query(`
      INSERT INTO delivery_status_history (delivery_id, status, actor_id)
      VALUES ($1, $2, $3)
    `, [stop.id, status, stop.assignedDriverId || stop.ownerAdminId]);
    await notifyDeliveryParticipants(client, stop.id, 'DELIVERY_STATUS', { status });
  }
  if (['DELIVERED', 'FAILED', 'CANCELLED'].includes(status)) {
    const assignmentStatus = status === 'DELIVERED' ? 'COMPLETED' : 'CANCELLED';
    const { rows: endedAssignments } = await client.query(`
      UPDATE delivery_assignments
      SET status = $2, ended_at = NOW(), end_reason = $3
      WHERE delivery_id = $1 AND status = 'ACTIVE'
      RETURNING assignment_id, rider_id
    `, [stop.id, assignmentStatus, status]);
    for (const assignment of endedAssignments) {
      await client.query(`
        INSERT INTO delivery_assignment_history
          (assignment_id, delivery_id, event_type, actor_id, details)
        VALUES ($1, $2, $3, $4, $5::jsonb)
      `, [
        assignment.assignment_id,
        stop.id,
        assignmentStatus,
        stop.assignedDriverId || stop.ownerAdminId,
        JSON.stringify({ status })
      ]);
    }
  }
}

async function findRelationalCandidates(client, deliveryId, radiusKm, selectedRiderId = null) {
  const { rows } = await client.query(`
    SELECT profile.rider_id,
      location.latitude AS rider_lat,
      location.longitude AS rider_lng,
      delivery.pickup_lat,
      delivery.pickup_lng,
      6371 * 2 * ASIN(SQRT(
        POWER(SIN(RADIANS(location.latitude - delivery.pickup_lat) / 2), 2)
        + COS(RADIANS(delivery.pickup_lat)) * COS(RADIANS(location.latitude))
        * POWER(SIN(RADIANS(location.longitude - delivery.pickup_lng) / 2), 2)
      )) AS distance_km
    FROM dispatch_deliveries AS delivery
    JOIN rider_dispatch_profiles AS profile
      ON profile.is_active = TRUE AND profile.is_available = TRUE
    JOIN rider_current_locations AS location
      ON location.rider_id = profile.rider_id AND location.sharing_enabled = TRUE
    WHERE delivery.delivery_id = $1
      AND delivery.pickup_lat IS NOT NULL AND delivery.pickup_lng IS NOT NULL
      AND location.recorded_at >= NOW() - INTERVAL '90 seconds'
      AND ($3::text IS NULL OR profile.rider_id = $3)
      AND (delivery.zone_id IS NULL OR profile.zone_id IS NULL
        OR lower(profile.zone_id) = lower(delivery.zone_id))
      AND (delivery.required_vehicle_type IS NULL
        OR lower(profile.vehicle_type) = lower(delivery.required_vehicle_type))
      AND (delivery.package_weight_kg IS NULL
        OR profile.max_package_weight_kg IS NULL
        OR delivery.package_weight_kg <= profile.max_package_weight_kg)
      AND (delivery.package_size IS NULL OR profile.max_package_size IS NULL
        OR CASE upper(delivery.package_size)
          WHEN 'SMALL' THEN 1 WHEN 'MEDIUM' THEN 2 WHEN 'LARGE' THEN 3 ELSE 99 END
          <= CASE upper(profile.max_package_size)
          WHEN 'SMALL' THEN 1 WHEN 'MEDIUM' THEN 2 WHEN 'LARGE' THEN 3 ELSE 0 END)
      AND NOT EXISTS (
        SELECT 1 FROM delivery_assignments AS active_assignment
        WHERE active_assignment.delivery_id = delivery.delivery_id
          AND active_assignment.status = 'ACTIVE'
      )
      AND NOT EXISTS (
        SELECT 1 FROM delivery_assignments AS rider_assignment
        WHERE rider_assignment.rider_id = profile.rider_id
          AND rider_assignment.status = 'ACTIVE'
      )
      AND location.latitude BETWEEN delivery.pickup_lat - ($2 / 110.574)
        AND delivery.pickup_lat + ($2 / 110.574)
      AND location.longitude BETWEEN delivery.pickup_lng
        - $2 / (111.320 * GREATEST(0.1, ABS(COS(RADIANS(delivery.pickup_lat)))))
        AND delivery.pickup_lng
        + $2 / (111.320 * GREATEST(0.1, ABS(COS(RADIANS(delivery.pickup_lat)))))
      AND 6371 * 2 * ASIN(SQRT(
        POWER(SIN(RADIANS(location.latitude - delivery.pickup_lat) / 2), 2)
        + COS(RADIANS(delivery.pickup_lat)) * COS(RADIANS(location.latitude))
        * POWER(SIN(RADIANS(location.longitude - delivery.pickup_lng) / 2), 2)
      )) <= $2
    ORDER BY distance_km, profile.rider_id
  `, [deliveryId, radiusKm, selectedRiderId]);
  if (!rows.length) return rows;
  const cells = cellsWithinRadius(Number(rows[0].pickup_lat), Number(rows[0].pickup_lng), radiusKm);
  return rows.filter(row =>
    Number(row.distance_km) <= radiusKm
    && isWithinSearchCells(cells, Number(row.rider_lat), Number(row.rider_lng))
  );
}

async function claimDeliveryAssignment({ deliveryId, offerId, ownerAdminId, riderId, relational = false }) {
  if (usesDatabase) {
    if (!databaseRequestClient) throw new Error('The active delivery transaction is unavailable.');
    if (relational) {
      const { rows: lockedProfiles } = await databaseRequestClient.query(`
        SELECT rider_id FROM rider_dispatch_profiles
        WHERE rider_id = $1 AND is_active = TRUE AND is_available = TRUE
        FOR UPDATE
      `, [riderId]);
      if (lockedProfiles.length !== 1) return false;
      const { rows: existingRiderAssignments } = await databaseRequestClient.query(`
        SELECT 1 FROM delivery_assignments
        WHERE rider_id = $1 AND status = 'ACTIVE'
        LIMIT 1
      `, [riderId]);
      if (existingRiderAssignments.length) return false;
      const { rows } = await databaseRequestClient.query(`
        INSERT INTO delivery_assignments (
          assignment_id, delivery_id, offer_id, rider_id, business_id, status
        )
        SELECT gen_random_uuid(), offer.delivery_id, offer.offer_id,
          offer.rider_id, offer.business_id, 'ACTIVE'
        FROM dispatch_offers AS offer
        JOIN dispatch_deliveries AS delivery ON delivery.delivery_id = offer.delivery_id
        JOIN rider_dispatch_profiles AS profile
          ON profile.rider_id = offer.rider_id
          AND profile.is_active = TRUE AND profile.is_available = TRUE
        JOIN rider_current_locations AS location
          ON location.rider_id = offer.rider_id AND location.sharing_enabled = TRUE
        WHERE offer.batch_id = $1::uuid
          AND offer.delivery_id = $2
          AND offer.business_id = $3
          AND offer.rider_id = $4
          AND offer.status = 'PENDING'
          AND offer.expires_at > NOW()
          AND delivery.status NOT IN ('DELIVERED', 'FAILED', 'CANCELLED')
          AND location.recorded_at >= NOW() - INTERVAL '90 seconds'
          AND (delivery.zone_id IS NULL OR profile.zone_id IS NULL
            OR lower(profile.zone_id) = lower(delivery.zone_id))
          AND (delivery.required_vehicle_type IS NULL
            OR lower(profile.vehicle_type) = lower(delivery.required_vehicle_type))
          AND (delivery.package_weight_kg IS NULL OR profile.max_package_weight_kg IS NULL
            OR delivery.package_weight_kg <= profile.max_package_weight_kg)
          AND (delivery.package_size IS NULL OR profile.max_package_size IS NULL
            OR CASE upper(delivery.package_size)
              WHEN 'SMALL' THEN 1 WHEN 'MEDIUM' THEN 2 WHEN 'LARGE' THEN 3 ELSE 99 END
              <= CASE upper(profile.max_package_size)
              WHEN 'SMALL' THEN 1 WHEN 'MEDIUM' THEN 2 WHEN 'LARGE' THEN 3 ELSE 0 END)
          AND 6371 * 2 * ASIN(SQRT(
            POWER(SIN(RADIANS(location.latitude - delivery.pickup_lat) / 2), 2)
            + COS(RADIANS(delivery.pickup_lat)) * COS(RADIANS(location.latitude))
            * POWER(SIN(RADIANS(location.longitude - delivery.pickup_lng) / 2), 2)
          )) <= offer.search_radius_km
          AND NOT EXISTS (
            SELECT 1 FROM delivery_assignments AS active_assignment
            WHERE active_assignment.rider_id = offer.rider_id
              AND active_assignment.status = 'ACTIVE'
          )
        ON CONFLICT DO NOTHING
        RETURNING assignment_id
      `, [offerId, deliveryId, ownerAdminId, riderId]);
      if (rows.length !== 1) return false;

      const { rows: reassignedRecords } = await databaseRequestClient.query(`
        UPDATE delivery_assignments
        SET status = 'REASSIGNED'
        WHERE delivery_id = $1 AND status = 'CANCELLED'
          AND end_reason = 'CANCELLED_BY_PARTY'
        RETURNING assignment_id, offer_id, rider_id
      `, [deliveryId]);
      for (const previousAssignment of reassignedRecords) {
        await databaseRequestClient.query(`
          INSERT INTO delivery_assignment_history
            (assignment_id, delivery_id, event_type, actor_id, details)
          VALUES ($1, $2, 'REASSIGNED', $3, '{"reason":"new_assignment_accepted"}'::jsonb)
        `, [previousAssignment.assignment_id, deliveryId, riderId]);
        if (previousAssignment.offer_id) {
          await databaseRequestClient.query(`
            UPDATE dispatch_offers SET status = 'REASSIGNED'
            WHERE offer_id = $1 AND status = 'CANCELLED'
          `, [previousAssignment.offer_id]);
        }
      }
      await databaseRequestClient.query(`
        UPDATE dispatch_offers
        SET status = CASE WHEN rider_id = $2 THEN 'ACCEPTED' ELSE 'CANCELLED' END,
            responded_at = CASE WHEN rider_id = $2 THEN NOW() ELSE responded_at END
        WHERE batch_id = $1::uuid AND status = 'PENDING'
      `, [offerId, riderId]);
      await databaseRequestClient.query(`
        UPDATE dispatch_deliveries SET status = 'RIDER_ACCEPTED', updated_at = NOW()
        WHERE delivery_id = $1 AND business_id = $2
      `, [deliveryId, ownerAdminId]);
      const assignment = await databaseRequestClient.query(`
        SELECT assignment_id FROM delivery_assignments
        WHERE delivery_id = $1 AND rider_id = $2 AND status = 'ACTIVE'
      `, [deliveryId, riderId]);
      await databaseRequestClient.query(`
        INSERT INTO delivery_assignment_history
          (assignment_id, delivery_id, event_type, actor_id)
        VALUES ($1, $2, 'ASSIGNED', $3)
      `, [assignment.rows[0].assignment_id, deliveryId, riderId]);
      await databaseRequestClient.query(`
        INSERT INTO delivery_status_history (delivery_id, status, actor_id)
        VALUES ($1, 'RIDER_ACCEPTED', $2)
      `, [deliveryId, riderId]);
      await notifyDeliveryParticipants(databaseRequestClient, deliveryId, 'RIDER_ACCEPTED', { riderId });
      return true;
    }
    if (hasActiveRiderAssignment(store.deliveryAssignments, store.stops, riderId)) return false;
    const { rowCount } = await databaseRequestClient.query(`
      INSERT INTO tobs_delivery_assignments
        (delivery_id, offer_id, owner_admin_id, rider_id)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (delivery_id) DO NOTHING
    `, [deliveryId, offerId, ownerAdminId, riderId]);
    return rowCount === 1;
  }

  if (hasActiveRiderAssignment(store.deliveryAssignments, store.stops, riderId)) return false;
  store.deliveryAssignments.push({
    deliveryId,
    offerId,
    ownerAdminId,
    riderId,
    status: 'ACTIVE',
    acceptedAt: new Date().toISOString()
  });
  return true;
}

function issueSession(response, user, remember = true, superAdminVerified = false) {
  const token = crypto.randomBytes(32).toString('base64url');
  const session = {
    userId: user.id,
    expiresAt: Date.now() + 12 * 60 * 60 * 1000,
    superAdminVerified,
    csrfToken: crypto.randomBytes(32).toString('base64url')
  };
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
  const requestOrigin = request.get('origin');
  if (requestOrigin && isAllowedBrowserOrigin(request)) {
    response.setHeader('Access-Control-Allow-Origin', requestOrigin);
    response.setHeader('Access-Control-Allow-Credentials', 'true');
    response.setHeader('Vary', 'Origin');
    if (request.method === 'OPTIONS') {
      response.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
      response.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-CSRF-Token');
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
app.use('/api', csrfProtection);

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
  if (user.role === 'DRIVER' && user.status !== 'ACTIVE') {
    return response.status(403).json({
      error: user.status === 'REJECTED'
        ? 'This driver application was not approved. Contact Tobs Circuit support for help.'
        : 'Your driver application is awaiting approval and verification.'
    });
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

app.get('/api/auth/csrf', requireUser, (request, response) => {
  const token = request.cookies?.[sessionCookie];
  const session = sessions.get(token);
  if (!session) return response.status(401).json({ error: 'Please sign in to continue.' });
  if (!session.csrfToken) {
    session.csrfToken = crypto.randomBytes(32).toString('base64url');
    const storedSession = store.sessions.find(item => item.token === token);
    if (storedSession) storedSession.csrfToken = session.csrfToken;
    writeStore();
  }
  return response.json({ csrfToken: session.csrfToken });
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
    verificationStatus: driver.verificationStatus || (driver.status === 'ACTIVE' ? 'VERIFIED' : 'PENDING'),
    verifiedAt: driver.verifiedAt || null,
    isAvailable: driver.isAvailable === true,
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

app.post('/api/super-admin/drivers/:id/verification', requireUser, requireSuperAdmin, async (request, response) => {
  const action = request.body.action;
  if (!['approve', 'reject'].includes(action)) {
    return response.status(400).json({ error: 'Choose approve or reject for this driver application.' });
  }
  const driver = store.users.find(user => user.id === request.params.id && user.role === 'DRIVER');
  if (!driver) return response.status(404).json({ error: 'Driver application not found.' });
  if (request.dispatchSchemaReady) {
    try {
      if (driver.ownerAdminId) {
        await databaseRequestClient.query(`
          INSERT INTO dispatch_business_riders (business_id, rider_id, zone_id)
          VALUES ($1, $2, $3)
          ON CONFLICT (business_id, rider_id)
          DO UPDATE SET zone_id = EXCLUDED.zone_id, active = TRUE
        `, [driver.ownerAdminId, driver.id, driver.zone || null]);
      }
      await databaseRequestClient.query(`
        INSERT INTO rider_dispatch_profiles
          (rider_id, is_active, is_available, vehicle_type, zone_id, updated_at)
        VALUES ($1, $2, FALSE, $3, $4, NOW())
        ON CONFLICT (rider_id)
        DO UPDATE SET is_active = EXCLUDED.is_active,
          is_available = FALSE, vehicle_type = EXCLUDED.vehicle_type,
          zone_id = EXCLUDED.zone_id, updated_at = NOW()
      `, [
        driver.id,
        action === 'approve',
        driver.vehicleType || null,
        driver.zone || null
      ]);
    } catch (error) {
      console.error('Could not update driver verification profile:', error);
      return response.status(503).json({ error: 'Driver verification could not be saved right now.' });
    }
  }
  driver.status = action === 'approve' ? 'ACTIVE' : 'REJECTED';
  driver.verificationStatus = action === 'approve' ? 'VERIFIED' : 'REJECTED';
  driver.verifiedAt = action === 'approve' ? new Date().toISOString() : null;
  driver.verifiedBy = action === 'approve' ? request.user.id : null;
  driver.isAvailable = false;
  driver.availabilityUpdatedAt = new Date().toISOString();
  writeStore();
  return response.json({ driver: {
    id: driver.id,
    status: driver.status,
    verificationStatus: driver.verificationStatus,
    verifiedAt: driver.verifiedAt
  } });
});

app.post('/api/auth/logout', (request, response) => {
  const token = request.cookies?.[sessionCookie];
  if (token) {
    const session = sessions.get(token);
    if (session?.userId) io.in(`user:${session.userId}`).disconnectSockets(true);
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
  const invite = token ? store.invitations.find(item =>
    item.token === token &&
    item.status === 'PENDING' &&
    (!item.email || item.email === email)
  ) : null;
  if (token && !invite) {
    return response.status(400).json({ error: 'This invitation link is invalid or has already been used.' });
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
    orgName: invite?.orgName || 'Tobs Circuit Driver Network',
    ...(invite?.ownerAdminId ? { ownerAdminId: invite.ownerAdminId } : {}),
    zone,
    vehicle,
    phone: cleanText(request.body.phone, 40),
    status: 'PENDING',
    verificationStatus: 'PENDING',
    isAvailable: false,
    isTracking: false,
    routeStatus: 'IDLE',
    createdAt: new Date().toISOString()
  };
  if (invite) {
    invite.status = 'REGISTERED';
    invite.registeredAt = new Date().toISOString();
  }
  store.users.push(user);
  writeStore();
  return response.status(201).json({
    pendingApproval: true,
    message: 'Your driver application has been submitted. You can sign in after platform verification and approval.',
    user: publicUser(user)
  });
});

app.get('/api/users', requireUser, (request, response) => {
  const ownerAdminId = request.user.role === 'ADMIN' ? request.user.id : request.user.ownerAdminId;
  const users = store.users.filter(user =>
    user.id === ownerAdminId || user.ownerAdminId === ownerAdminId
  );
  return response.json({ users: users.map(user => publicUserForViewer(user, request.user)) });
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
  const sendThreads = () => {
    const visibleThreads = store.supportThreads.filter(thread =>
      request.user.role === 'CUSTOMER_CARE' || isSuperAdmin(request.user) || thread.userId === request.user.id
    ).sort((left, right) => new Date(right.updatedAt || right.createdAt).getTime() - new Date(left.updatedAt || left.createdAt).getTime());

    return response.json({
      threads: visibleThreads.map(thread => ({
        ...thread,
        messages: Array.isArray(thread.messages) ? thread.messages.slice(-12) : []
      }))
    });
  };

  return isSuperAdmin(request.user)
    ? requireSuperAdmin(request, response, sendThreads)
    : sendThreads();
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
    const sendReply = () => {
      const text = cleanText(request.body.text, 2000);
      if (!text) return response.status(400).json({ error: 'Write a reply before sending.' });
      const threadId = cleanText(request.body.threadId, 128);
      const thread = store.supportThreads.find(item => item.id === threadId);
      if (!thread) return response.status(404).json({ error: 'Support case not found.' });

      const isOwnerReply = isSuperAdmin(request.user);
      const reply = {
        id: crypto.randomUUID(),
        sender: isOwnerReply ? 'SUPER_ADMIN' : 'CUSTOMER_CARE',
        senderName: isOwnerReply ? 'Super Admin' : request.user.name,
        text,
        createdAt: new Date().toISOString()
      };
      thread.messages = [...(thread.messages || []), reply];
      thread.status = 'IN_PROGRESS';
      thread.assignedTo = isOwnerReply ? 'SUPER_ADMIN' : request.user.email;
      thread.updatedAt = reply.createdAt;
      delete thread.resolvedAt;
      writeStore();
      return response.json({ thread: { ...thread, messages: thread.messages.slice(-12) } });
    };

    if (request.user.role === 'CUSTOMER_CARE') return sendReply();
    if (isSuperAdmin(request.user)) return requireSuperAdmin(request, response, sendReply);
    return response.status(403).json({ error: 'Only Customer Care or a verified Super Admin can reply to support cases.' });
  }

  return next();
});

app.patch('/api/super-admin/customer-care', requireUser, (request, response) => {
  const updateStatus = () => {
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
  };

  if (request.user.role === 'CUSTOMER_CARE') return updateStatus();
  if (isSuperAdmin(request.user)) return requireSuperAdmin(request, response, updateStatus);
  return response.status(403).json({ error: 'Only Customer Care or a verified Super Admin can update support cases.' });
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
  const stops = store.stops.filter(stop =>
    request.user.role === 'ADMIN'
      ? stop.ownerAdminId === request.user.id
      : stop.assignedDriverId === request.user.id
  );
  return response.json({ stops });
});

app.get('/api/dispatch/map-riders', requireUser, requireAdmin, rateLimit({ windowMs: 60_000, limit: 60 }), async (request, response) => {
  const now = Date.now();
  const visibleRiders = new Map();
  if (request.dispatchSchemaReady) {
    try {
      const { rows } = await databaseRequestClient.query(AUTHORIZED_MAP_RIDERS_SQL, [request.user.id]);
      for (const row of rows) {
        const rider = store.users.find(user => user.id === row.rider_id && user.role === 'DRIVER');
        if (!rider || !validCoordinates(Number(row.lat), Number(row.lng))) continue;
        const locationUpdatedAt = new Date(row.location_updated_at).toISOString();
        visibleRiders.set(rider.id, {
          id: rider.id,
          name: rider.name,
          vehicle: rider.vehicle || '',
          lat: Number(row.lat),
          lng: Number(row.lng),
          locationUpdatedAt,
          isTracking: now - new Date(locationUpdatedAt).getTime() < 90_000,
          isAvailable: row.assigned !== true,
          deliveryId: row.delivery_id,
          dispatchStatus: row.dispatch_status,
          assigned: row.assigned === true
        });
      }
    } catch (error) {
      console.error('Could not load authorized dispatch map riders:', error);
      return response.status(503).json({ error: 'Rider map locations are temporarily unavailable.' });
    }
  } else {
    const activeStatus = new Set([
      'RIDER_ASSIGNED', 'RIDER_ACCEPTED', 'HEADING_TO_PICKUP',
      'ARRIVED_AT_PICKUP', 'HEADING_TO_DESTINATION'
    ]);
    const activeDeliveryByRider = new Map(store.stops
      .filter(stop => stop.ownerAdminId === request.user.id
        && activeStatus.has(stop.dispatchStatus)
        && stop.assignedDriverId)
      .map(stop => [stop.assignedDriverId, stop]));
    const busyRiderIds = new Set(store.stops
      .filter(stop => activeStatus.has(stop.dispatchStatus) && stop.assignedDriverId)
      .map(stop => stop.assignedDriverId));
    for (const rider of store.users) {
      if (rider.role !== 'DRIVER' || rider.status !== 'ACTIVE'
        || rider.isAvailable !== true || rider.isTracking !== true
        || busyRiderIds.has(rider.id) || !validCoordinates(rider.lat, rider.lng)) continue;
      const locationUpdatedAt = new Date(rider.locationUpdatedAt || '').getTime();
      if (!Number.isFinite(locationUpdatedAt) || now - locationUpdatedAt >= 90_000) continue;
      visibleRiders.set(rider.id, {
        id: rider.id,
        name: rider.name,
        vehicle: rider.vehicle || '',
        lat: rider.lat,
        lng: rider.lng,
        locationUpdatedAt: rider.locationUpdatedAt,
        isTracking: true,
        isAvailable: true,
        deliveryId: null,
        dispatchStatus: null,
        assigned: false
      });
    }
    const pendingOffers = store.deliveryOffers.filter(offer =>
      offer.ownerAdminId === request.user.id
      && offer.status === 'OPEN'
      && new Date(offer.expiresAt).getTime() > now
    );
    for (const offer of pendingOffers) {
      const stop = store.stops.find(item =>
        item.id === offer.stopId && item.ownerAdminId === request.user.id
      );
      if (!stop) continue;
      for (const riderId of offer.riderIds) {
        if (offer.rejectedByIds.includes(riderId) || activeDeliveryByRider.has(riderId)) continue;
        const rider = store.users.find(user => user.id === riderId && user.role === 'DRIVER');
        if (!rider || rider.status !== 'ACTIVE' || rider.isAvailable !== true
          || rider.isTracking !== true || !validCoordinates(rider.lat, rider.lng)) continue;
        const updatedAt = new Date(rider.locationUpdatedAt || '').getTime();
        if (!Number.isFinite(updatedAt) || now - updatedAt >= 90_000) continue;
        if (!visibleRiders.has(rider.id)) {
          visibleRiders.set(rider.id, {
            id: rider.id,
            name: rider.name,
            vehicle: rider.vehicle || '',
            lat: rider.lat,
            lng: rider.lng,
            locationUpdatedAt: rider.locationUpdatedAt,
            isTracking: true,
            isAvailable: true,
            deliveryId: stop.id,
            dispatchStatus: stop.dispatchStatus || 'FINDING_RIDER',
            assigned: false
          });
        }
      }
    }
    for (const [riderId, stop] of activeDeliveryByRider) {
      const rider = store.users.find(user => user.id === riderId && user.role === 'DRIVER');
      if (!rider || rider.isTracking !== true || !validCoordinates(rider.lat, rider.lng)) continue;
      const updatedAt = new Date(rider.locationUpdatedAt || '').getTime();
      if (!Number.isFinite(updatedAt)) continue;
      visibleRiders.set(rider.id, {
        id: rider.id,
        name: rider.name,
        vehicle: rider.vehicle || '',
        lat: rider.lat,
        lng: rider.lng,
        locationUpdatedAt: rider.locationUpdatedAt,
        isTracking: now - updatedAt < 90_000,
        isAvailable: false,
        deliveryId: stop.id,
        dispatchStatus: stop.dispatchStatus,
        assigned: true
      });
    }
  }
  response.setHeader('Cache-Control', 'private, no-store');
  const riders = [...visibleRiders.values()].map(rider => ({
    ...rider,
    zone: store.users.find(user => user.id === rider.id)?.zone || ''
  }));
  return response.json({ riders });
});

app.get('/api/marketplace/drivers', requireUser, requireAdmin, rateLimit({ limit: 60 }), async (request, response) => {
  const pickup = {
    lat: request.query.lat === undefined ? null : Number(request.query.lat),
    lng: request.query.lng === undefined ? null : Number(request.query.lng)
  };
  if ((pickup.lat !== null || pickup.lng !== null)
    && !validCoordinates(pickup.lat, pickup.lng)) {
    return response.status(400).json({ error: 'The pickup coordinates are invalid.' });
  }
  const now = Date.now();
  const activeStatuses = new Set([
    'RIDER_ASSIGNED', 'RIDER_ACCEPTED', 'HEADING_TO_PICKUP', 'ARRIVED_AT_PICKUP',
    'HEADING_TO_DESTINATION'
  ]);
  const busyDriverIds = new Set([
    ...store.stops
      .filter(stop => activeStatuses.has(dispatchStatusFromStop(stop)) && stop.assignedDriverId)
      .map(stop => stop.assignedDriverId),
    ...store.deliveryAssignments
      .filter(assignment => assignment.status === 'ACTIVE')
      .map(assignment => assignment.riderId)
  ]);
  let candidates;
  if (request.dispatchSchemaReady) {
    try {
      const { rows } = await databaseRequestClient.query(PUBLIC_MARKETPLACE_DRIVERS_SQL, [
        pickup.lat ?? 0,
        pickup.lng ?? 0,
        pickup.lat !== null && pickup.lng !== null
      ]);
      candidates = rows;
    } catch (error) {
      console.error('Could not search public driver marketplace:', error);
      return response.status(503).json({ error: 'The public driver marketplace is temporarily unavailable.' });
    }
  } else {
    candidates = store.users.filter(driver => {
      if (driver.role !== 'DRIVER' || driver.status !== 'ACTIVE'
        || driver.isAvailable !== true || driver.routeStatus !== 'IDLE'
        || driver.isTracking !== true || !validCoordinates(driver.lat, driver.lng)
        || busyDriverIds.has(driver.id)) return false;
      const updatedAt = new Date(driver.locationUpdatedAt || '').getTime();
      if (!Number.isFinite(updatedAt) || now - updatedAt >= 90_000) return false;
      return pickup.lat === null || distanceInKilometers(pickup, driver) <= 10;
    }).map(driver => ({
      rider_id: driver.id,
      name: driver.name,
      vehicle: driver.vehicle || '',
      vehicle_type: driver.vehicleType || null,
      zone: driver.zone || '',
      lat: driver.lat,
      lng: driver.lng,
      location_updated_at: driver.locationUpdatedAt,
      distance_km: pickup.lat === null ? null : distanceInKilometers(pickup, driver)
    }));
  }
  const safeDrivers = candidates
    .filter(driver => !busyDriverIds.has(driver.rider_id)
      && (pickup.lat === null || Number(driver.distance_km) <= 10))
    .map(driver => ({
      id: driver.rider_id,
      name: driver.name || 'Tobs Circuit driver',
      vehicle: driver.vehicle || driver.vehicle_type || '',
      zone: driver.zone || '',
      lat: Number(driver.lat),
      lng: Number(driver.lng),
      locationUpdatedAt: new Date(driver.location_updated_at).toISOString(),
      distanceKm: driver.distance_km === null ? null : Number(Number(driver.distance_km).toFixed(2)),
      etaMinutes: driver.distance_km === null ? null : Math.max(1, Math.ceil(Number(driver.distance_km) / 20 * 60))
    }));
  response.setHeader('Cache-Control', 'private, no-store');
  return response.json({ drivers: safeDrivers });
});

app.get('/api/geocode/search', requireUser, rateLimit({ limit: 30 }), async (request, response) => {
  const { q } = request.query;
  const lat = request.query.lat === undefined ? undefined : Number(request.query.lat);
  const lng = request.query.lon === undefined ? undefined : Number(request.query.lon);
  if (typeof q !== 'string' || q.trim().length < 2) {
    return response.status(400).json({ error: 'Enter at least two characters to search for an address.' });
  }
  if ((lat !== undefined || lng !== undefined) && !validCoordinates(lat, lng)) {
    return response.status(400).json({ error: 'The address search location is invalid.' });
  }
  const baseUrl = process.env.PHOTON_BASE_URL || (!isProduction ? 'https://photon.komoot.io' : '');
  try {
    const features = await searchPhoton({ baseUrl, query: q, lat, lng });
    response.setHeader('Cache-Control', 'private, no-store');
    return response.json({ features });
  } catch (error) {
    console.error('Address search provider failed:', error.message);
    return response.status(baseUrl ? 502 : 503).json({
      error: baseUrl
        ? 'Address suggestions are temporarily unavailable.'
        : 'Address search is not configured on this server.'
    });
  }
});

app.get('/api/geocode/reverse', requireUser, rateLimit({ limit: 20 }), async (request, response) => {
  const lat = Number(request.query.lat);
  const lng = Number(request.query.lon);
  if (!validCoordinates(lat, lng)) {
    return response.status(400).json({ error: 'The reverse-geocoding coordinates are invalid.' });
  }
  const baseUrl = process.env.PHOTON_BASE_URL || (!isProduction ? 'https://photon.komoot.io' : '');
  try {
    const features = await searchPhoton({ baseUrl, lat, lng, reverse: true });
    response.setHeader('Cache-Control', 'private, no-store');
    return response.json({ features });
  } catch (error) {
    console.error('Reverse-geocoding provider failed:', error.message);
    return response.status(baseUrl ? 502 : 503).json({
      error: baseUrl
        ? 'Reverse geocoding is temporarily unavailable.'
        : 'Address search is not configured on this server.'
    });
  }
});

app.get('/api/routing/route', requireUser, rateLimit({ limit: 30 }), async (request, response) => {
  const from = { lat: Number(request.query.fromLat), lng: Number(request.query.fromLng) };
  const to = { lat: Number(request.query.toLat), lng: Number(request.query.toLng) };
  if (!validCoordinates(from.lat, from.lng) || !validCoordinates(to.lat, to.lng)) {
    return response.status(400).json({ error: 'The route coordinates are invalid.' });
  }
  const routingBaseUrl = process.env.VALHALLA_BASE_URL || '';
  const routingProfile = process.env.VALHALLA_PROFILE || 'auto';
  if (!['auto', 'car', 'driving', 'bicycle', 'cycling', 'pedestrian', 'walking', 'motorcycle'].includes(routingProfile)) {
    return response.status(503).json({ error: 'The routing profile is not configured correctly on this server.' });
  }
  try {
    const route = await getRoadRoute({
      baseUrl: routingBaseUrl,
      profile: routingProfile,
      from,
      to
    });
    if (route.mode !== 'road') {
      console.warn('Using an explicitly labelled straight-line route fallback.');
    }
    response.setHeader('Cache-Control', 'private, no-store');
    return response.json(route);
  } catch (error) {
    if (error instanceof TypeError) return response.status(400).json({ error: error.message });
    console.error('Road routing failed:', error.message);
    return response.status(503).json({ error: 'Route calculation is temporarily unavailable.' });
  }
});

app.get('/api/pricing/rules', requireUser, requireSuperAdmin, async (request, response) => {
  if (!request.dispatchSchemaReady) {
    return response.status(503).json({ error: 'Platform pricing is unavailable until the marketplace migration is applied.' });
  }
  try {
    const { rows } = await databaseRequestClient.query(`
      SELECT version, currency, base_fee, per_kilometre, per_minute,
             additional_fee, updated_at
      FROM platform_pricing_rules
      WHERE rule_id = 1
    `);
    const row = rows[0];
    return response.json({ rules: row ? {
      version: row.version,
      currency: row.currency,
      baseFee: Number(row.base_fee),
      perKilometre: Number(row.per_kilometre),
      perMinute: Number(row.per_minute),
      additionalFee: Number(row.additional_fee),
      updatedAt: row.updated_at
    } : null });
  } catch (error) {
    console.error('Could not load platform pricing rules:', error);
    return response.status(503).json({ error: 'Platform pricing rules could not be loaded.' });
  }
});

app.put('/api/pricing/rules', requireUser, requireSuperAdmin, async (request, response) => {
  const rules = {
    currency: cleanText(request.body.currency, 3).toUpperCase(),
    baseFee: request.body.baseFee,
    perKilometre: request.body.perKilometre,
    perMinute: request.body.perMinute,
    additionalFee: request.body.additionalFee
  };
  if (!validatePricingRules(rules)) {
    return response.status(400).json({
      error: 'Enter a three-letter currency and non-negative pricing amounts up to 1,000,000.'
    });
  }
  if (!request.dispatchSchemaReady) {
    return response.status(503).json({ error: 'Platform pricing is unavailable until the marketplace migration is applied.' });
  }
  try {
    const { rows } = await databaseRequestClient.query(`
      INSERT INTO platform_pricing_rules
        (rule_id, version, currency, base_fee, per_kilometre, per_minute, additional_fee, updated_by)
      VALUES (1, 1, $1, $2, $3, $4, $5, $6)
      ON CONFLICT (rule_id)
      DO UPDATE SET version = platform_pricing_rules.version + 1,
        currency = EXCLUDED.currency, base_fee = EXCLUDED.base_fee,
        per_kilometre = EXCLUDED.per_kilometre, per_minute = EXCLUDED.per_minute,
        additional_fee = EXCLUDED.additional_fee, updated_by = EXCLUDED.updated_by,
        updated_at = NOW()
      RETURNING version, currency, base_fee, per_kilometre, per_minute,
                additional_fee, updated_at
    `, [
      rules.currency, rules.baseFee, rules.perKilometre, rules.perMinute,
      rules.additionalFee, request.user.id
    ]);
    const row = rows[0];
    return response.json({ rules: {
      version: row.version,
      currency: row.currency,
      baseFee: Number(row.base_fee),
      perKilometre: Number(row.per_kilometre),
      perMinute: Number(row.per_minute),
      additionalFee: Number(row.additional_fee),
      updatedAt: row.updated_at
    } });
  } catch (error) {
    console.error('Could not update platform pricing rules:', error);
    return response.status(503).json({ error: 'Platform pricing rules could not be saved.' });
  }
});

app.post('/api/pricing/estimate', requireUser, requireAdmin, rateLimit({ limit: 30 }), async (request, response) => {
  const from = request.body?.from;
  const to = request.body?.to;
  if (!validCoordinates(from?.lat, from?.lng) || !validCoordinates(to?.lat, to?.lng)) {
    return response.status(400).json({ error: 'Select pickup and destination from the address suggestions.' });
  }
  if (!request.dispatchSchemaReady) {
    return response.status(503).json({ error: 'Automated pricing is not configured until the marketplace migration is applied.' });
  }
  try {
    const { rows } = await databaseRequestClient.query(`
      SELECT version, currency, base_fee, per_kilometre, per_minute, additional_fee
      FROM platform_pricing_rules
      WHERE rule_id = 1
    `);
    if (!rows.length) {
      return response.status(503).json({ error: 'The platform administrator has not configured delivery pricing yet.' });
    }
    const row = rows[0];
    const rules = {
      version: row.version,
      currency: row.currency,
      baseFee: Number(row.base_fee),
      perKilometre: Number(row.per_kilometre),
      perMinute: Number(row.per_minute),
      additionalFee: Number(row.additional_fee)
    };
    const route = await getRoadRoute({
      baseUrl: process.env.VALHALLA_BASE_URL || '',
      profile: process.env.VALHALLA_PROFILE || 'auto',
      from,
      to
    });
    const price = estimateDeliveryPrice({
      distanceKm: route.distanceKm,
      durationMinutes: route.durationMinutes,
      rules
    });
    const quote = {
      businessId: request.user.id,
      pickup: from,
      destination: to,
      distanceKm: route.distanceKm,
      durationMinutes: route.durationMinutes,
      price: price.amount,
      currency: price.currency,
      ruleVersion: price.ruleVersion,
      expiresAt: Date.now() + 10 * 60_000
    };
    return response.json({
      route,
      estimate: price,
      quoteToken: signPricingQuote(quote),
      expiresAt: new Date(quote.expiresAt).toISOString()
    });
  } catch (error) {
    if (error instanceof TypeError || error instanceof RangeError) {
      return response.status(400).json({ error: error.message });
    }
    console.error('Could not calculate delivery price:', error);
    return response.status(503).json({ error: 'Price estimation is temporarily unavailable.' });
  }
});

app.post('/api/stops/:id/offers', requireUser, requireAdmin, async (request, response) => {
  const stop = store.stops.find(item =>
    item.id === request.params.id && item.ownerAdminId === request.user.id
  );
  if (!stop) return response.status(404).json({ error: 'Delivery not found in your business.' });
  if (stop.assignedDriverId) return response.status(409).json({ error: 'This delivery already has an assigned rider.' });
  if (!stop.pickupAddress || !stop.address
    || !validCoordinates(stop.pickupLat, stop.pickupLng)
    || !validCoordinates(stop.lat, stop.lng)) {
    return response.status(400).json({
      error: 'Select exact pickup and delivery addresses from the map suggestions before finding a rider.'
    });
  }

  const now = Date.now();
  const selectedRiderId = request.body.riderId === undefined
    ? null
    : cleanText(request.body.riderId, 128);
  if (request.body.riderId !== undefined && !selectedRiderId) {
    return response.status(400).json({ error: 'Select a valid available driver.' });
  }
  if (request.dispatchSchemaReady) {
    try {
      const client = databaseRequestClient;
      if (!client) throw new Error('The active dispatch transaction is unavailable.');
      await client.query('SAVEPOINT dispatch_offer_create');
      await syncDispatchDelivery(client, stop);
      await client.query(`
        UPDATE dispatch_offers
        SET status = 'EXPIRED'
        WHERE delivery_id = $1 AND status = 'PENDING' AND expires_at <= NOW()
      `, [stop.id]);
      const { rows: activeRows } = await client.query(`
        SELECT batch_id, COUNT(*)::integer AS rider_count
        FROM dispatch_offers
        WHERE delivery_id = $1 AND business_id = $2
          AND status = 'PENDING' AND expires_at > NOW()
        GROUP BY batch_id
        ORDER BY MAX(created_at) DESC
        LIMIT 1
      `, [stop.id, request.user.id]);
      const { rows: activeBatchOffers } = await client.query(`
        SELECT batch.batch_offer_id, COUNT(DISTINCT batch.rider_id)::integer AS rider_count
        FROM delivery_batch_offers AS batch
        JOIN delivery_batch_offer_items AS item
          ON item.batch_offer_id = batch.batch_offer_id
        WHERE item.delivery_id = $1 AND item.business_id = $2
          AND batch.status = 'PENDING' AND batch.expires_at > NOW()
        GROUP BY batch.batch_offer_id
        ORDER BY MAX(batch.created_at) DESC
        LIMIT 1
      `, [stop.id, request.user.id]);
      if (activeBatchOffers.length) {
        await client.query('RELEASE SAVEPOINT dispatch_offer_create');
        return response.json({
          offerId: activeBatchOffers[0].batch_offer_id,
          riderCount: activeBatchOffers[0].rider_count,
          groupedRiderCount: activeBatchOffers[0].rider_count,
          reused: true
        });
      }
      if (activeRows.length) {
        await client.query('RELEASE SAVEPOINT dispatch_offer_create');
        return response.json({
          offerId: activeRows[0].batch_id,
          riderCount: activeRows[0].rider_count,
          reused: true
        });
      }

      let radiusKm = 0;
      let eligibleRiders = [];
      for (const radius of RIDER_DISCOVERY_RADIUS_ROUNDS_KM) {
        eligibleRiders = await findRelationalCandidates(client, stop.id, radius, selectedRiderId);
        if (eligibleRiders.length) {
          radiusKm = radius;
          break;
        }
      }
      if (!eligibleRiders.length) {
        await client.query('RELEASE SAVEPOINT dispatch_offer_create');
        return response.json({ offerId: null, riderCount: 0, reused: false });
      }

      const batchId = crypto.randomUUID();
      const expiresAt = new Date(now + 2 * 60 * 1000).toISOString();
      for (const candidate of eligibleRiders) {
        await client.query(`
          INSERT INTO dispatch_offers (
            offer_id, batch_id, delivery_id, business_id, rider_id,
            search_radius_km, status, expires_at
          )
          VALUES ($1, $2::uuid, $3, $4, $5, $6, 'PENDING', $7)
          ON CONFLICT (offer_id) DO NOTHING
        `, [
          crypto.randomUUID(),
          batchId,
          stop.id,
          request.user.id,
          candidate.rider_id,
          radiusKm,
          expiresAt
        ]);
      }
      store.deliveryOffers = store.deliveryOffers.map(offer =>
        offer.stopId === stop.id && offer.status === 'OPEN'
          ? { ...offer, status: 'CLOSED' }
          : offer
      );
      store.deliveryOffers.push({
        id: batchId,
        stopId: stop.id,
        ownerAdminId: request.user.id,
        riderIds: eligibleRiders.map(rider => rider.rider_id),
        rejectedByIds: [],
        status: 'OPEN',
        searchRadiusKm: radiusKm,
        createdAt: new Date(now).toISOString(),
        expiresAt
      });
      stop.dispatchStatus = 'FINDING_RIDER';
      stop.dispatchStatusHistory = [
        ...(Array.isArray(stop.dispatchStatusHistory) ? stop.dispatchStatusHistory : []),
        { status: 'FINDING_RIDER', at: new Date(now).toISOString() }
      ];
      await client.query(`
        UPDATE dispatch_deliveries SET status = 'FINDING_RIDER', updated_at = NOW()
        WHERE delivery_id = $1 AND business_id = $2
      `, [stop.id, request.user.id]);
      await client.query(`
        INSERT INTO delivery_status_history (delivery_id, status, actor_id)
        VALUES ($1, 'FINDING_RIDER', $2)
      `, [stop.id, request.user.id]);
      await client.query('RELEASE SAVEPOINT dispatch_offer_create');
      writeStore();
      return response.status(201).json({
        offerId: batchId,
        riderCount: eligibleRiders.length,
        groupedRiderCount: 0,
        radiusKm,
        reused: false
      });
    } catch (error) {
      try {
        await databaseRequestClient?.query('ROLLBACK TO SAVEPOINT dispatch_offer_create');
      } catch (rollbackError) {
        console.error('Could not roll back rider-offer creation:', rollbackError);
      }
      console.error('Could not create relational rider offers:', error);
      return response.status(503).json({ error: 'Rider discovery is temporarily unavailable.' });
    }
  }

  const activeOffer = store.deliveryOffers.find(offer =>
    offer.stopId === stop.id
    && offer.ownerAdminId === request.user.id
    && offer.status === 'OPEN'
    && new Date(offer.expiresAt).getTime() > now
    && offer.riderIds.some(riderId => !offer.rejectedByIds.includes(riderId))
  );
  if (activeOffer) {
    return response.json({ offerId: activeOffer.id, riderCount: activeOffer.riderIds.length, reused: true });
  }

  const busyStatuses = new Set(['DELIVERED', 'FAILED', 'UNDELIVERED', 'DELIVERY_FAILED', 'CANCELLED']);
  const h3Cells = cellsWithinRadius(stop.pickupLat, stop.pickupLng, 5);
  const eligibleRiders = store.users.filter(rider => {
    if (rider.role !== 'DRIVER' || (selectedRiderId && rider.id !== selectedRiderId)
      || rider.status !== 'ACTIVE' || rider.isAvailable !== true || rider.routeStatus !== 'IDLE'
      || !rider.isTracking || !validCoordinates(rider.lat, rider.lng)) return false;
    const updatedAt = new Date(rider.locationUpdatedAt || '').getTime();
    if (!Number.isFinite(updatedAt) || now - updatedAt >= 90_000) return false;
    if (!isWithinSearchCells(h3Cells, rider.lat, rider.lng)) return false;
    const hasActiveDelivery = store.stops.some(item =>
      item.assignedDriverId === rider.id
      && !busyStatuses.has(String(item.status || '').toUpperCase())
    );
    if (hasActiveDelivery) return false;
    return distanceInKilometers(
      { lat: rider.lat, lng: rider.lng },
      { lat: stop.pickupLat, lng: stop.pickupLng }
    ) <= 5;
  }).sort((left, right) =>
    distanceInKilometers(
      { lat: left.lat, lng: left.lng },
      { lat: stop.pickupLat, lng: stop.pickupLng }
    ) - distanceInKilometers(
      { lat: right.lat, lng: right.lng },
      { lat: stop.pickupLat, lng: stop.pickupLng }
    )
  );

  store.deliveryOffers = store.deliveryOffers.map(offer =>
    offer.stopId === stop.id && offer.status === 'OPEN'
      ? { ...offer, status: 'CLOSED' }
      : offer
  );
  if (eligibleRiders.length === 0) {
    writeStore();
    return response.json({ offerId: null, riderCount: 0, reused: false });
  }

  const offer = {
    id: crypto.randomUUID(),
    stopId: stop.id,
    ownerAdminId: request.user.id,
    riderIds: eligibleRiders.map(rider => rider.id),
    rejectedByIds: [],
    status: 'OPEN',
    createdAt: new Date().toISOString(),
    expiresAt: new Date(now + 2 * 60 * 1000).toISOString()
  };
  store.deliveryOffers.push(offer);
  stop.dispatchStatus = 'FINDING_RIDER';
  stop.dispatchStatusHistory = [
    ...(Array.isArray(stop.dispatchStatusHistory) ? stop.dispatchStatusHistory : []),
    { status: 'FINDING_RIDER', at: offer.createdAt }
  ];
  writeStore();
  return response.status(201).json({ offerId: offer.id, riderCount: eligibleRiders.length, reused: false });
});

app.get('/api/delivery-offers', requireUser, async (request, response) => {
  const now = Date.now();
  if (request.dispatchSchemaReady) {
    try {
      await databaseRequestClient.query(`
        UPDATE dispatch_offers
        SET status = 'EXPIRED'
        WHERE status = 'PENDING' AND expires_at <= NOW()
      `);
      await databaseRequestClient.query(`
        UPDATE delivery_batch_offers
        SET status = 'EXPIRED'
        WHERE status = 'PENDING' AND expires_at <= NOW()
      `);
    } catch (error) {
      console.error('Could not expire stale delivery offers:', error);
      return response.status(503).json({ error: 'Delivery offers are temporarily unavailable.' });
    }
  }
  const visibleOffers = store.deliveryOffers.filter(offer => {
    if (request.user.role === 'ADMIN') {
      return offer.ownerAdminId === request.user.id
        && (offer.status === 'ACCEPTED'
          && ['RIDER_ACCEPTED', 'HEADING_TO_PICKUP', 'ARRIVED_AT_PICKUP', 'HEADING_TO_DESTINATION']
            .includes(store.stops.find(stop => stop.id === offer.stopId)?.dispatchStatus)
          || (offer.status === 'OPEN' && new Date(offer.expiresAt).getTime() > now));
    }
    return request.user.role === 'DRIVER'
      && offer.status === 'OPEN'
      && new Date(offer.expiresAt).getTime() > now
      && offer.riderIds.includes(request.user.id)
      && !offer.rejectedByIds.includes(request.user.id)
      && request.user.isAvailable === true
      && request.user.isTracking === true
      && validCoordinates(request.user.lat, request.user.lng)
      && Number.isFinite(new Date(request.user.locationUpdatedAt || '').getTime())
      && now - new Date(request.user.locationUpdatedAt).getTime() < 90_000;
  });

  const offers = visibleOffers.flatMap(offer => {
    const stop = store.stops.find(item => item.id === offer.stopId && item.ownerAdminId === offer.ownerAdminId);
    if (!stop) return [];
    const rider = offer.status === 'ACCEPTED'
      ? store.users.find(user => user.id === offer.acceptedRiderId && user.role === 'DRIVER')
      : null;
    const pickup = { lat: stop.pickupLat, lng: stop.pickupLng };
    const destination = { lat: stop.lat, lng: stop.lng };
    const driverLocation = request.user.role === 'DRIVER'
      ? { lat: request.user.lat, lng: request.user.lng }
      : null;
    const routeDistanceKm = validCoordinates(pickup.lat, pickup.lng) && validCoordinates(destination.lat, destination.lng)
      ? distanceInKilometers(pickup, destination)
      : null;
    return [{
      id: offer.id,
      status: offer.status,
      createdAt: offer.createdAt,
      expiresAt: offer.expiresAt,
      stop: {
        id: stop.id,
        name: stop.name,
        address: stop.address,
        lat: stop.lat,
        lng: stop.lng,
        pickupAddress: stop.pickupAddress,
        pickupLat: stop.pickupLat,
        pickupLng: stop.pickupLng,
        packages: stop.packages,
        packageDescription: stop.packageDescription || '',
        packageWeightKg: stop.packageWeightKg ?? null,
        packageSize: stop.packageSize || '',
        priority: stop.priority,
        riderEarningsNgn: stop.riderEarningsNgn ?? null,
        assignedDriverId: stop.assignedDriverId || ''
      },
      businessName: store.users.find(user => user.id === offer.ownerAdminId)?.orgName || 'Business',
      pickupDistanceKm: driverLocation && validCoordinates(driverLocation.lat, driverLocation.lng)
        ? distanceInKilometers(driverLocation, pickup)
        : null,
      routeDistanceKm,
      routeEtaMinutes: routeDistanceKm === null ? null : Math.max(1, Math.ceil(routeDistanceKm / 20 * 60)),
      rider: rider ? {
        id: rider.id,
        name: rider.name,
        phone: rider.phone || '',
        vehicle: rider.vehicle || '',
        zone: rider.zone || '',
        lat: validCoordinates(rider.lat, rider.lng) ? rider.lat : null,
        lng: validCoordinates(rider.lat, rider.lng) ? rider.lng : null,
        locationUpdatedAt: rider.locationUpdatedAt || null
      } : null
    }];
  });
  if (request.dispatchSchemaReady) {
    try {
      const { rows } = await databaseRequestClient.query(`
        SELECT batch.batch_offer_id, batch.rider_id, batch.status,
               batch.expires_at, batch.route,
               item.delivery_id, item.business_id, item.sequence_number,
               delivery.status AS dispatch_status, delivery.pickup_address,
               delivery.pickup_lat, delivery.pickup_lng,
               delivery.destination_address, delivery.destination_lat,
               delivery.destination_lng, delivery.package_count,
               delivery.package_description, delivery.package_size,
               delivery.package_weight_kg, delivery.rider_earnings_ngn,
               delivery.deadline_at
        FROM delivery_batch_offers AS batch
        JOIN delivery_batch_offer_items AS item
          ON item.batch_offer_id = batch.batch_offer_id
        JOIN dispatch_deliveries AS delivery
          ON delivery.delivery_id = item.delivery_id
         AND delivery.business_id = item.business_id
        WHERE (
          ($1 = 'DRIVER' AND batch.rider_id = $2 AND batch.status = 'PENDING'
            AND batch.expires_at > NOW())
          OR ($1 = 'ADMIN' AND item.business_id = $2 AND batch.status = 'ACCEPTED')
        )
          AND (
            $1 <> 'DRIVER'
            OR (
              EXISTS (
                SELECT 1
                FROM rider_dispatch_profiles AS profile
                WHERE profile.rider_id = batch.rider_id
                  AND profile.is_active = TRUE
                  AND profile.is_available = TRUE
              )
              AND NOT EXISTS (
                SELECT 1
                FROM delivery_batch_offer_items AS restricted_item
                WHERE restricted_item.batch_offer_id = batch.batch_offer_id
                  AND NOT EXISTS (
                    SELECT 1
                    FROM dispatch_business_riders AS membership
                    WHERE membership.business_id = restricted_item.business_id
                      AND membership.rider_id = batch.rider_id
                      AND membership.active = TRUE
                  )
              )
            )
          )
        ORDER BY batch.created_at DESC, item.sequence_number
      `, [request.user.role, request.user.id]);
      const groups = new Map();
      for (const row of rows) {
        const stopRecord = store.stops.find(stop =>
          stop.id === row.delivery_id && stop.ownerAdminId === row.business_id
        );
        if (!stopRecord) continue;
        const stop = {
          id: stopRecord.id,
          name: stopRecord.name,
          address: row.destination_address,
          lat: Number(row.destination_lat),
          lng: Number(row.destination_lng),
          pickupAddress: row.pickup_address,
          pickupLat: Number(row.pickup_lat),
          pickupLng: Number(row.pickup_lng),
          packages: row.package_count,
          packageDescription: row.package_description,
          packageSize: row.package_size || '',
          packageWeightKg: row.package_weight_kg === null ? null : Number(row.package_weight_kg),
          riderEarningsNgn: row.rider_earnings_ngn === null ? null : Number(row.rider_earnings_ngn),
          deliveryDeadlineAt: row.deadline_at,
          dispatchStatus: row.dispatch_status,
          assignedDriverId: row.status === 'ACCEPTED' ? row.rider_id : ''
        };
        const id = row.batch_offer_id;
        let group = groups.get(id);
        if (!group) {
          const rider = row.status === 'ACCEPTED'
            ? store.users.find(user => user.id === row.rider_id && user.role === 'DRIVER')
            : null;
          group = {
            id,
            status: row.status === 'ACCEPTED' ? 'ACCEPTED' : 'OPEN',
            batch: true,
            batchStops: [],
            stop: null,
            expiresAt: row.expires_at,
            route: row.route,
            rider: rider ? {
              id: rider.id,
              name: rider.name,
              phone: rider.phone || '',
              vehicle: rider.vehicle || '',
              zone: rider.zone || '',
              lat: validCoordinates(rider.lat, rider.lng) ? rider.lat : null,
              lng: validCoordinates(rider.lat, rider.lng) ? rider.lng : null,
              locationUpdatedAt: rider.locationUpdatedAt || null
            } : null,
            businessName: store.users.find(user => user.id === row.business_id)?.orgName || 'Business'
          };
          groups.set(id, group);
        }
        group.batchStops.push(stop);
        if (!group.stop) group.stop = stop;
      }
      if (request.user.role === 'DRIVER') {
        offers.push(...groups.values());
      } else {
        for (const group of groups.values()) {
          for (const stop of group.batchStops) {
            offers.push({ ...group, stop, batchStops: [stop] });
          }
        }
      }
    } catch (error) {
      console.error('Could not load delivery batch offers:', error);
      return response.status(503).json({ error: 'Delivery batch offers are temporarily unavailable.' });
    }
  }
  response.setHeader('Cache-Control', 'private, no-store');
  return response.json({ offers });
});

app.get('/api/dispatch/notifications', requireUser, rateLimit({ windowMs: 60_000, limit: 60 }), async (request, response) => {
  if (!request.dispatchSchemaReady) return response.json({ notifications: [] });
  try {
    const { rows } = await databaseRequestClient.query(`
      SELECT notification_id, delivery_id, notification_type, payload, created_at, read_at
      FROM dispatch_notifications
      WHERE recipient_id = $1
      ORDER BY created_at DESC
      LIMIT 100
    `, [request.user.id]);
    response.setHeader('Cache-Control', 'private, no-store');
    return response.json({ notifications: rows });
  } catch (error) {
    console.error('Could not load dispatch notifications:', error);
    return response.status(503).json({ error: 'Notifications are temporarily unavailable.' });
  }
});

app.patch('/api/dispatch/notifications/:id/read', requireUser, async (request, response) => {
  if (!request.dispatchSchemaReady) return response.status(503).json({ error: 'Dispatch notifications are unavailable.' });
  try {
    const { rowCount } = await databaseRequestClient.query(`
      UPDATE dispatch_notifications SET read_at = COALESCE(read_at, NOW())
      WHERE notification_id::text = $1 AND recipient_id = $2
    `, [request.params.id, request.user.id]);
    if (!rowCount) return response.status(404).json({ error: 'Notification not found.' });
    return response.json({ ok: true });
  } catch (error) {
    console.error('Could not mark dispatch notification as read:', error);
    return response.status(503).json({ error: 'Notification status could not be updated.' });
  }
});

app.get('/api/dispatch/deliveries/:id/messages', requireUser, rateLimit({ limit: 120 }), async (request, response) => {
  if (!request.dispatchSchemaReady) return response.status(503).json({ error: 'Delivery messaging is unavailable.' });
  if (!['ADMIN', 'DRIVER'].includes(request.user.role)) {
    return response.status(403).json({ error: 'This account cannot access delivery conversations.' });
  }
  try {
    const authorized = await databaseRequestClient.query(`
      SELECT 1
      FROM dispatch_deliveries AS delivery
      JOIN delivery_assignments AS assignment
        ON assignment.delivery_id = delivery.delivery_id
       AND assignment.business_id = delivery.business_id
      WHERE delivery.delivery_id = $1
        AND (
          ($2 = 'ADMIN' AND delivery.business_id = $3)
          OR ($2 = 'DRIVER' AND assignment.rider_id = $3)
        )
        AND assignment.status IN ('ACTIVE', 'COMPLETED')
      LIMIT 1
    `, [request.params.id, request.user.role, request.user.id]);
    if (!authorized.rowCount) {
      return response.status(404).json({ error: 'No delivery conversation is available to this account.' });
    }
    await databaseRequestClient.query(`
      UPDATE delivery_messages AS message
      SET delivered_at = COALESCE(message.delivered_at, NOW()),
          read_at = COALESCE(message.read_at, NOW())
      WHERE message.delivery_id = $1 AND message.sender_id <> $3
        AND EXISTS (
          SELECT 1 FROM dispatch_deliveries AS delivery
          JOIN delivery_assignments AS assignment
            ON assignment.delivery_id = delivery.delivery_id
           AND assignment.business_id = delivery.business_id
          WHERE delivery.delivery_id = message.delivery_id
            AND (
              ($2 = 'ADMIN' AND delivery.business_id = $3)
              OR ($2 = 'DRIVER' AND assignment.rider_id = $3)
            )
            AND assignment.status IN ('ACTIVE', 'COMPLETED')
        )
    `, [request.params.id, request.user.role, request.user.id]);
    await databaseRequestClient.query(`
      UPDATE dispatch_notifications
      SET read_at = COALESCE(read_at, NOW())
      WHERE recipient_id = $1 AND delivery_id = $2
        AND notification_type = 'DELIVERY_MESSAGE' AND read_at IS NULL
    `, [request.user.id, request.params.id]);
    const { rows } = await databaseRequestClient.query(`
      SELECT message.message_id, message.client_message_id, message.sender_id,
             message.body, message.sent_at,
             message.delivered_at, message.read_at
      FROM delivery_messages AS message
      JOIN dispatch_deliveries AS delivery
        ON delivery.delivery_id = message.delivery_id
       AND delivery.business_id = message.business_id
      WHERE message.delivery_id = $1
        AND (
          ($2 = 'ADMIN' AND delivery.business_id = $3)
          OR ($2 = 'DRIVER' AND message.rider_id = $3)
        )
        AND EXISTS (
          SELECT 1 FROM delivery_assignments AS assignment
          WHERE assignment.delivery_id = message.delivery_id
            AND assignment.business_id = message.business_id
            AND assignment.rider_id = message.rider_id
            AND assignment.status IN ('ACTIVE', 'COMPLETED')
        )
      ORDER BY message.sent_at, message.message_id
      LIMIT 200
    `, [request.params.id, request.user.role, request.user.id]);
    response.setHeader('Cache-Control', 'private, no-store');
    return response.json({ messages: rows });
  } catch (error) {
    console.error('Could not load authorized delivery messages:', error);
    return response.status(503).json({ error: 'Delivery messages are temporarily unavailable.' });
  }
});

app.post('/api/dispatch/deliveries/:id/messages', requireUser, rateLimit({ limit: 60 }), async (request, response) => {
  if (!request.dispatchSchemaReady) return response.status(503).json({ error: 'Delivery messaging is unavailable.' });
  if (!['ADMIN', 'DRIVER'].includes(request.user.role)) {
    return response.status(403).json({ error: 'This account cannot send delivery messages.' });
  }
  const body = cleanText(request.body.message, 2000);
  if (!body) return response.status(400).json({ error: 'Type a message before sending.' });
  const clientMessageId = request.body.clientMessageId || crypto.randomUUID();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clientMessageId)) {
    return response.status(400).json({ error: 'The message retry identifier is invalid.' });
  }
  let messageSavepoint = false;
  try {
    const authorized = await databaseRequestClient.query(`
      SELECT 1
      FROM dispatch_deliveries AS delivery
      JOIN delivery_assignments AS assignment
        ON assignment.delivery_id = delivery.delivery_id
       AND assignment.business_id = delivery.business_id
       AND assignment.status = 'ACTIVE'
      WHERE delivery.delivery_id = $1
        AND delivery.status NOT IN ('DELIVERED', 'FAILED', 'CANCELLED')
        AND (
          ($2 = 'ADMIN' AND delivery.business_id = $3)
          OR ($2 = 'DRIVER' AND assignment.rider_id = $3)
        )
      LIMIT 1
    `, [request.params.id, request.user.role, request.user.id]);
    if (!authorized.rowCount) {
      return response.status(404).json({ error: 'No active delivery conversation is available to this account.' });
    }
    await databaseRequestClient.query('SAVEPOINT dispatch_message_send');
    messageSavepoint = true;
    const { rows } = await databaseRequestClient.query(`
      INSERT INTO delivery_messages (
        message_id, client_message_id, delivery_id, business_id, rider_id, sender_id, body
      )
      SELECT $1, $2, delivery.delivery_id, delivery.business_id, assignment.rider_id, $3, $4
      FROM dispatch_deliveries AS delivery
      JOIN delivery_assignments AS assignment
        ON assignment.delivery_id = delivery.delivery_id
       AND assignment.business_id = delivery.business_id
       AND assignment.status = 'ACTIVE'
      WHERE delivery.delivery_id = $5
        AND delivery.status NOT IN ('DELIVERED', 'FAILED', 'CANCELLED')
        AND (
          ($6 = 'ADMIN' AND delivery.business_id = $3)
          OR ($6 = 'DRIVER' AND assignment.rider_id = $3)
        )
      ON CONFLICT (sender_id, client_message_id)
        WHERE client_message_id IS NOT NULL DO NOTHING
      RETURNING message_id, client_message_id, delivery_id, business_id, rider_id,
                sender_id, body, sent_at
    `, [
      crypto.randomUUID(),
      clientMessageId,
      request.user.id,
      body,
      request.params.id,
      request.user.role
    ]);
    let message = rows[0];
    let duplicate = false;
    if (!message) {
      const existing = await databaseRequestClient.query(`
        SELECT message_id, client_message_id, delivery_id, business_id, rider_id,
               sender_id, body, sent_at
        FROM delivery_messages
        WHERE sender_id = $1 AND client_message_id = $2
      `, [request.user.id, clientMessageId]);
      if (!existing.rows.length
        || existing.rows[0].delivery_id !== request.params.id
        || existing.rows[0].body !== body) {
        await databaseRequestClient.query('RELEASE SAVEPOINT dispatch_message_send');
        messageSavepoint = false;
        return response.status(409).json({ error: 'This message retry identifier was already used for a different message.' });
      }
      [message] = existing.rows;
      duplicate = true;
    }
    if (duplicate) {
      await databaseRequestClient.query('RELEASE SAVEPOINT dispatch_message_send');
      messageSavepoint = false;
      return response.status(200).json({ message, duplicate: true });
    }
    const recipientId = request.user.role === 'ADMIN' ? message.rider_id : message.business_id;
    await databaseRequestClient.query(`
      INSERT INTO dispatch_notifications
        (notification_id, recipient_id, delivery_id, notification_type, payload)
      VALUES ($1, $2, $3, 'DELIVERY_MESSAGE', $4::jsonb)
    `, [
      crypto.randomUUID(),
      recipientId,
      message.delivery_id,
      JSON.stringify({ messageId: message.message_id, senderId: request.user.id })
    ]);
    await databaseRequestClient.query('RELEASE SAVEPOINT dispatch_message_send');
    messageSavepoint = false;
    io.to(`user:${recipientId}`).emit('dispatch:message', message);
    return response.status(201).json({ message });
  } catch (error) {
    if (messageSavepoint) {
      try {
        await databaseRequestClient.query('ROLLBACK TO SAVEPOINT dispatch_message_send');
        await databaseRequestClient.query('RELEASE SAVEPOINT dispatch_message_send');
      } catch (rollbackError) {
        console.error('Could not roll back a partial delivery message:', rollbackError);
      }
    }
    console.error('Could not send authorized delivery message:', error);
    return response.status(503).json({ error: 'The delivery message could not be sent right now.' });
  }
});

async function getTwilioIceServers() {
  const { TWILIO_ACCOUNT_SID: accountSid, TWILIO_API_KEY: apiKey, TWILIO_API_SECRET: apiSecret } = process.env;
  if (!accountSid || !apiKey || !apiSecret) {
    const error = new Error('Voice calling is not configured on the server.');
    error.status = 503;
    throw error;
  }

  const tokenUrl = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Tokens.json`;
  const authorization = Buffer.from(`${apiKey}:${apiSecret}`).toString('base64');
  const tokenResponse = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${authorization}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({ Ttl: '3600' }),
    signal: AbortSignal.timeout(10_000)
  });
  if (!tokenResponse.ok) {
    const error = new Error('Twilio could not issue temporary voice-call credentials.');
    error.status = 503;
    throw error;
  }
  const token = await tokenResponse.json();
  if (!Array.isArray(token.ice_servers) || token.ice_servers.length === 0) {
    const error = new Error('Twilio returned no voice-call ICE servers.');
    error.status = 503;
    throw error;
  }
  return token.ice_servers.map(server => ({
    urls: server.urls,
    ...(server.username ? { username: server.username } : {}),
    ...(server.credential ? { credential: server.credential } : {})
  }));
}

async function resolveCallContext(request) {
  const { deliveryId, supportThreadId, targetUserId } = request.body;
  const user = request.user;
  const verifiedOwner = isSuperAdmin(user)
    && sessions.get(request.cookies?.[sessionCookie])?.superAdminVerified === true;

  if (typeof deliveryId === 'string' && deliveryId) {
    const { rows } = await databaseRequestClient.query(`
      SELECT delivery.delivery_id, delivery.business_id, assignment.rider_id
      FROM dispatch_deliveries AS delivery
      JOIN delivery_assignments AS assignment
        ON assignment.delivery_id = delivery.delivery_id
       AND assignment.business_id = delivery.business_id
       AND assignment.status = 'ACTIVE'
      WHERE delivery.delivery_id = $1
        AND delivery.status NOT IN ('DELIVERED', 'FAILED', 'CANCELLED')
    `, [deliveryId]);
    if (!rows.length) return null;
    const context = rows[0];
    let recipientId;
    if (verifiedOwner) {
      recipientId = targetUserId;
      if (![context.business_id, context.rider_id].includes(recipientId)) return null;
    } else if (user.role === 'ADMIN' && context.business_id === user.id) {
      recipientId = context.rider_id;
    } else if (user.role === 'DRIVER' && context.rider_id === user.id) {
      recipientId = context.business_id;
    } else {
      return null;
    }
    return {
      deliveryId: context.delivery_id,
      supportThreadId: null,
      businessId: context.business_id,
      riderId: context.rider_id,
      callerId: user.id,
      recipientId
    };
  }

  if (typeof supportThreadId === 'string' && supportThreadId) {
    const thread = store.supportThreads.find(item => item.id === supportThreadId);
    if (!thread) return null;
    let recipientId;
    if (verifiedOwner) {
      recipientId = thread.userId;
    } else if (['ADMIN', 'DRIVER'].includes(user.role) && thread.userId === user.id) {
      recipientId = store.users.find(isSuperAdmin)?.id;
      if (!recipientId) return null;
    } else {
      return null;
    }
    if (recipientId === user.id) return null;
    return {
      deliveryId: null,
      supportThreadId: thread.id,
      businessId: null,
      riderId: null,
      callerId: user.id,
      recipientId
    };
  }
  return null;
}

async function sendMissedCallNotification(call, client = databasePool) {
  const notificationId = crypto.randomUUID();
  const recipientId = call.caller_id;
  await client.query(`
    INSERT INTO dispatch_notifications
      (notification_id, recipient_id, delivery_id, notification_type, payload)
    VALUES ($1, $2, $3, 'MISSED_CALL', $4::jsonb)
  `, [
    notificationId,
    recipientId,
    call.delivery_id,
    JSON.stringify({ callId: call.call_id, supportThreadId: call.support_thread_id })
  ]);
  io.to(`user:${recipientId}`).emit('dispatch:call:missed', {
    callId: call.call_id,
    supportThreadId: call.support_thread_id,
    deliveryId: call.delivery_id
  });
  io.to(`user:${call.recipient_id}`).emit('dispatch:call:missed', {
    callId: call.call_id,
    supportThreadId: call.support_thread_id,
    deliveryId: call.delivery_id
  });
}

app.get('/api/dispatch/calls', requireUser, rateLimit({ limit: 120 }), async (request, response) => {
  if (!request.dispatchCallsReady) return response.status(503).json({ error: 'Voice call history is unavailable.' });
  const deliveryId = cleanText(request.query.deliveryId, 128);
  const supportThreadId = cleanText(request.query.supportThreadId, 128);
  const verifiedOwner = isSuperAdmin(request.user)
    && sessions.get(request.cookies?.[sessionCookie])?.superAdminVerified === true;
  if (isSuperAdmin(request.user) && !verifiedOwner) {
    return response.status(401).json({ error: 'Owner email verification is required.' });
  }
  if ((!deliveryId && !supportThreadId) || (deliveryId && supportThreadId)) {
    return response.status(400).json({ error: 'Choose one call conversation.' });
  }
  try {
    if (supportThreadId) {
      const thread = store.supportThreads.find(item => item.id === supportThreadId);
      if (!thread || (!verifiedOwner && thread.userId !== request.user.id)) {
        return response.status(403).json({ error: 'This call history is not available to your account.' });
      }
    } else if (!verifiedOwner) {
      const participant = await databaseRequestClient.query(`
        SELECT 1 FROM dispatch_deliveries AS delivery
        JOIN delivery_assignments AS assignment
          ON assignment.delivery_id = delivery.delivery_id
         AND assignment.business_id = delivery.business_id
         AND assignment.status IN ('ACTIVE', 'COMPLETED')
        WHERE delivery.delivery_id = $1 AND $2 IN (delivery.business_id, assignment.rider_id)
      `, [deliveryId, request.user.id]);
      if (!participant.rowCount) {
        return response.status(403).json({ error: 'This call history is not available to your account.' });
      }
    }
    const staleCalls = await databaseRequestClient.query(`
      UPDATE dispatch_calls
      SET status = 'MISSED', ended_at = NOW(), end_reason = 'NO_ANSWER'
      WHERE status = 'RINGING' AND created_at < NOW() - INTERVAL '45 seconds'
        AND (($1::text IS NOT NULL AND delivery_id = $1)
          OR ($2::text IS NOT NULL AND support_thread_id = $2))
      RETURNING call_id, delivery_id, support_thread_id, caller_id, recipient_id
    `, [deliveryId || null, supportThreadId || null]);
    for (const call of staleCalls.rows) await sendMissedCallNotification(call, databaseRequestClient);
    const { rows } = await databaseRequestClient.query(`
      SELECT call_id, delivery_id, support_thread_id, caller_id, recipient_id,
             status, created_at, answered_at, ended_at, end_reason
      FROM dispatch_calls
      WHERE (($1::text IS NOT NULL AND delivery_id = $1)
        OR ($2::text IS NOT NULL AND support_thread_id = $2))
        AND ($3::boolean OR $4 IN (caller_id, recipient_id))
      ORDER BY created_at DESC
      LIMIT 30
    `, [deliveryId || null, supportThreadId || null, verifiedOwner, request.user.id]);
    await databaseRequestClient.query(`
      UPDATE dispatch_notifications
      SET read_at = COALESCE(read_at, NOW())
      WHERE recipient_id = $1 AND notification_type IN ('INCOMING_CALL', 'MISSED_CALL')
        AND payload->>'callId' IN (
          SELECT call_id::text FROM dispatch_calls
          WHERE (($2::text IS NOT NULL AND delivery_id = $2)
            OR ($3::text IS NOT NULL AND support_thread_id = $3))
        )
    `, [request.user.id, deliveryId || null, supportThreadId || null]);
    response.setHeader('Cache-Control', 'private, no-store');
    return response.json({ calls: rows });
  } catch (error) {
    console.error('Could not load authorized voice call history:', error);
    return response.status(503).json({ error: 'Voice call history is temporarily unavailable.' });
  }
});

app.post('/api/dispatch/calls', requireUser, rateLimit({ limit: 20 }), async (request, response) => {
  if (!request.dispatchCallsReady) return response.status(503).json({ error: 'Voice calling is unavailable.' });
  if (!['ADMIN', 'DRIVER'].includes(request.user.role)) {
    return response.status(403).json({ error: 'This account cannot start voice calls.' });
  }
  if (isSuperAdmin(request.user)
    && sessions.get(request.cookies?.[sessionCookie])?.superAdminVerified !== true) {
    return response.status(401).json({ error: 'Owner email verification is required.' });
  }
  let callSavepoint = false;
  try {
    const context = await resolveCallContext(request);
    if (!context) return response.status(403).json({ error: 'No authorized call conversation is available.' });
    const iceServers = await getTwilioIceServers();
    const callId = crypto.randomUUID();
    await databaseRequestClient.query('SAVEPOINT dispatch_call_start');
    callSavepoint = true;
    const { rows } = await databaseRequestClient.query(`
      INSERT INTO dispatch_calls (
        call_id, delivery_id, support_thread_id, business_id, rider_id,
        caller_id, recipient_id, status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'RINGING')
      RETURNING call_id, delivery_id, support_thread_id, caller_id,
                recipient_id, status, created_at
    `, [
      callId,
      context.deliveryId,
      context.supportThreadId,
      context.businessId,
      context.riderId,
      context.callerId,
      context.recipientId
    ]);
    const call = rows[0];
    await databaseRequestClient.query(`
      INSERT INTO dispatch_notifications
        (notification_id, recipient_id, delivery_id, notification_type, payload)
      VALUES ($1, $2, $3, 'INCOMING_CALL', $4::jsonb)
    `, [
      crypto.randomUUID(),
      context.recipientId,
      context.deliveryId,
      JSON.stringify({ callId, supportThreadId: context.supportThreadId, callerId: context.callerId })
    ]);
    await databaseRequestClient.query('RELEASE SAVEPOINT dispatch_call_start');
    callSavepoint = false;
    const caller = store.users.find(item => item.id === request.user.id);
    io.to(`user:${context.recipientId}`).emit('dispatch:call:incoming', {
      ...call,
      callerName: caller?.name || 'Tobs Circuit user'
    });
    const missedCallTimer = setTimeout(async () => {
      try {
        const { rows: missed } = await databasePool.query(`
          UPDATE dispatch_calls
          SET status = 'MISSED', ended_at = NOW(), end_reason = 'NO_ANSWER'
          WHERE call_id = $1 AND status = 'RINGING'
          RETURNING call_id, delivery_id, support_thread_id, caller_id, recipient_id
        `, [callId]);
        if (missed.length) await sendMissedCallNotification(missed[0]);
      } catch (error) {
        console.error('Could not expire an unanswered dispatch call:', error);
      }
    }, 45_000);
    missedCallTimer.unref();
    return response.status(201).json({ call, iceServers });
  } catch (error) {
    if (callSavepoint) {
      try {
        await databaseRequestClient.query('ROLLBACK TO SAVEPOINT dispatch_call_start');
        await databaseRequestClient.query('RELEASE SAVEPOINT dispatch_call_start');
      } catch (rollbackError) {
        console.error('Could not roll back a partial dispatch call:', rollbackError);
      }
    }
    if (error.status === 503) return response.status(503).json({ error: error.message });
    if (error.code === '23505') {
      return response.status(409).json({ error: 'A call is already active for this conversation.' });
    }
    console.error('Could not start authorized voice call:', error);
    return response.status(503).json({ error: 'The voice call could not be started.' });
  }
});

app.post('/api/dispatch/calls/:id/:action', requireUser, rateLimit({ limit: 60 }), async (request, response) => {
  if (!request.dispatchCallsReady) return response.status(503).json({ error: 'Voice calling is unavailable.' });
  const { id, action } = request.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
    || !['accept', 'reject', 'end'].includes(action)) {
    return response.status(400).json({ error: 'The call request is invalid.' });
  }
  if (isSuperAdmin(request.user)
    && sessions.get(request.cookies?.[sessionCookie])?.superAdminVerified !== true) {
    return response.status(401).json({ error: 'Owner email verification is required.' });
  }
  let actionSavepoint = false;
  try {
    let iceServers;
    if (action === 'accept') iceServers = await getTwilioIceServers();
    await databaseRequestClient.query('SAVEPOINT dispatch_call_action');
    actionSavepoint = true;
    const { rows } = await databaseRequestClient.query(`
      UPDATE dispatch_calls
      SET status = CASE $3
            WHEN 'accept' THEN 'ACCEPTED'
            WHEN 'reject' THEN 'REJECTED'
            ELSE 'ENDED'
          END,
          answered_at = CASE WHEN $3 = 'accept' THEN NOW() ELSE answered_at END,
          ended_at = CASE WHEN $3 = 'accept' THEN NULL ELSE NOW() END,
          end_reason = CASE
            WHEN $3 = 'reject' THEN 'REJECTED'
            WHEN $3 = 'end' AND status = 'RINGING' THEN 'CANCELLED'
            WHEN $3 = 'end' THEN 'HANGUP'
            ELSE NULL
          END
      WHERE call_id = $1
        AND $2 IN (caller_id, recipient_id)
        AND (($3 IN ('accept', 'reject') AND recipient_id = $2 AND status = 'RINGING')
          OR ($3 = 'end' AND status IN ('RINGING', 'ACCEPTED')))
      RETURNING call_id, delivery_id, support_thread_id, caller_id,
                recipient_id, status, created_at, answered_at, ended_at, end_reason
    `, [id, request.user.id, action]);
    if (!rows.length) {
      await databaseRequestClient.query('RELEASE SAVEPOINT dispatch_call_action');
      actionSavepoint = false;
      return response.status(404).json({ error: 'This call is not available to your account.' });
    }
    const call = rows[0];
    const otherParty = call.caller_id === request.user.id ? call.recipient_id : call.caller_id;
    await databaseRequestClient.query(`
      UPDATE dispatch_notifications
      SET read_at = COALESCE(read_at, NOW())
      WHERE recipient_id IN ($1, $2) AND notification_type = 'INCOMING_CALL'
        AND payload->>'callId' = $3
    `, [request.user.id, otherParty, call.call_id]);
    await databaseRequestClient.query('RELEASE SAVEPOINT dispatch_call_action');
    actionSavepoint = false;
    const eventName = action === 'accept'
      ? 'dispatch:call:accepted'
      : action === 'reject'
        ? 'dispatch:call:rejected'
        : 'dispatch:call:ended';
    io.to(`user:${otherParty}`).emit(eventName, { call });
    return response.json({ call, ...(iceServers ? { iceServers } : {}) });
  } catch (error) {
    if (actionSavepoint) {
      try {
        await databaseRequestClient.query('ROLLBACK TO SAVEPOINT dispatch_call_action');
        await databaseRequestClient.query('RELEASE SAVEPOINT dispatch_call_action');
      } catch (rollbackError) {
        console.error('Could not roll back a partial call status update:', rollbackError);
      }
    }
    if (error.status === 503) return response.status(503).json({ error: error.message });
    console.error('Could not update authorized voice call:', error);
    return response.status(503).json({ error: 'The voice call could not be updated.' });
  }
});

app.post('/api/delivery-offers/:id/accept', requireUser, async (request, response) => {
  if (request.user.role !== 'DRIVER') {
    return response.status(403).json({ error: 'Only a rider can accept a delivery offer.' });
  }
  if (request.dispatchSchemaReady) {
    try {
      const { rows: batchRows } = await databaseRequestClient.query(`
        SELECT 1 FROM delivery_batch_offers
        WHERE batch_offer_id::text = $1 AND rider_id = $2
        LIMIT 1
      `, [request.params.id, request.user.id]);
      if (batchRows.length) {
        await databaseRequestClient.query(`
          UPDATE delivery_batch_offers
          SET status = 'CANCELLED'
          WHERE batch_offer_id::text = $1 AND rider_id = $2 AND status = 'PENDING'
        `, [request.params.id, request.user.id]);
        return response.status(409).json({
          error: 'This grouped offer is no longer available. Drivers can accept one delivery at a time.'
        });
      }
    } catch (error) {
      console.error('Could not atomically accept the delivery batch:', error);
      return response.status(503).json({ error: 'The delivery batch could not be accepted right now.' });
    }
  }
  const offer = store.deliveryOffers.find(item => item.id === request.params.id);
  if (!offer || !offer.riderIds.includes(request.user.id)) {
    return response.status(404).json({ error: 'This delivery offer is no longer available to you.' });
  }
  const now = Date.now();
  if (offer.status !== 'OPEN' || new Date(offer.expiresAt).getTime() <= now
    || offer.rejectedByIds.includes(request.user.id)) {
    return response.status(409).json({ error: 'This delivery offer has expired or is no longer available.' });
  }
  const stop = store.stops.find(item =>
    item.id === offer.stopId && item.ownerAdminId === offer.ownerAdminId
  );
  const rider = store.users.find(item =>
    item.id === request.user.id && item.role === 'DRIVER'
  );
  if (!stop || stop.assignedDriverId) {
    return response.status(409).json({ error: 'Another rider has already accepted this delivery.' });
  }
  const locationUpdatedAt = new Date(rider?.locationUpdatedAt || '').getTime();
  const riderHasActiveDelivery = store.stops.some(item =>
    item.assignedDriverId === rider?.id
    && !['DELIVERED', 'FAILED', 'UNDELIVERED', 'DELIVERY_FAILED', 'CANCELLED']
      .includes(String(item.status || '').toUpperCase())
  );
  if (!rider || rider.status !== 'ACTIVE' || rider.isAvailable !== true || rider.routeStatus !== 'IDLE'
    || !rider.isTracking || !validCoordinates(rider.lat, rider.lng)
    || !Number.isFinite(locationUpdatedAt) || now - locationUpdatedAt >= 90_000
    || riderHasActiveDelivery
    || distanceInKilometers(
      { lat: rider.lat, lng: rider.lng },
      { lat: stop.pickupLat, lng: stop.pickupLng }
    ) > (Number.isFinite(offer.searchRadiusKm) ? offer.searchRadiusKm : 5)) {
    return response.status(409).json({
      error: 'You are no longer eligible for this offer. Confirm availability and live location, then check for another delivery.'
    });
  }

  try {
    const assignmentCreated = await claimDeliveryAssignment({
      deliveryId: stop.id,
      offerId: offer.id,
      ownerAdminId: offer.ownerAdminId,
      riderId: rider.id,
      relational: request.dispatchSchemaReady === true
    });
    if (!assignmentCreated) {
      return response.status(409).json({ error: 'Another rider has already accepted this delivery.' });
    }

    const acceptedAt = new Date().toISOString();
    stop.assignedDriverId = rider.id;
    stop.assignedAt = acceptedAt;
    stop.acceptedAt = acceptedAt;
    stop.dispatchStatus = 'RIDER_ACCEPTED';
    stop.dispatchStatusHistory = [
      ...(Array.isArray(stop.dispatchStatusHistory) ? stop.dispatchStatusHistory : []),
      { status: 'RIDER_ACCEPTED', at: acceptedAt, riderId: rider.id }
    ];
    offer.status = 'ACCEPTED';
    offer.acceptedRiderId = rider.id;
    offer.acceptedAt = acceptedAt;
    store.deliveryOffers = store.deliveryOffers.map(otherOffer =>
      otherOffer.stopId === stop.id && otherOffer.id !== offer.id && otherOffer.status === 'OPEN'
        ? { ...otherOffer, status: 'CLOSED' }
        : otherOffer
    );
    if (usesDatabase) {
      store.deliveryAssignments.push({
        deliveryId: stop.id,
        offerId: offer.id,
        ownerAdminId: offer.ownerAdminId,
        riderId: rider.id,
        acceptedAt
      });
    }
    rider.isAvailable = false;
    rider.availabilityUpdatedAt = acceptedAt;
    rider.routeStatus = 'ACCEPTED';
    rider.routeStopCount = 1;
    rider.routeUpdatedAt = acceptedAt;
    if (request.dispatchSchemaReady) {
      await databaseRequestClient.query(`
        UPDATE rider_dispatch_profiles
        SET is_available = FALSE, updated_at = NOW()
        WHERE rider_id = $1
      `, [rider.id]);
    }
    writeStore();
    return response.json({ stop, rider: publicUser(rider) });
  } catch (error) {
    console.error('Could not atomically assign the delivery offer:', error);
    return response.status(503).json({ error: 'The delivery could not be assigned because the database is temporarily unavailable.' });
  }
});

app.post('/api/delivery-offers/:id/reject', requireUser, async (request, response) => {
  if (request.user.role !== 'DRIVER') {
    return response.status(403).json({ error: 'Only a rider can reject a delivery offer.' });
  }
  if (request.dispatchSchemaReady) {
    try {
      const { rows } = await databaseRequestClient.query(`
        UPDATE delivery_batch_offers
        SET status = 'REJECTED'
        WHERE batch_offer_id::text = $1 AND rider_id = $2
          AND status = 'PENDING' AND expires_at > NOW()
        RETURNING batch_offer_id
      `, [request.params.id, request.user.id]);
      if (rows.length) return response.json({ ok: true });
    } catch (error) {
      console.error('Could not reject the delivery batch offer:', error);
      return response.status(503).json({ error: 'The delivery batch offer could not be updated right now.' });
    }
  }
  const offer = store.deliveryOffers.find(item =>
    item.id === request.params.id && item.riderIds.includes(request.user.id)
  );
  if (!offer || offer.status !== 'OPEN' || new Date(offer.expiresAt).getTime() <= Date.now()) {
    return response.status(409).json({ error: 'This delivery offer is no longer available.' });
  }
  if (request.dispatchSchemaReady) {
    try {
      const { rowCount } = await databaseRequestClient.query(`
        UPDATE dispatch_offers
        SET status = 'REJECTED', responded_at = NOW()
        WHERE batch_id = $1::uuid AND rider_id = $2
          AND status = 'PENDING' AND expires_at > NOW()
      `, [request.params.id, request.user.id]);
      if (rowCount !== 1) {
        return response.status(409).json({ error: 'This delivery offer is no longer available.' });
      }
    } catch (error) {
      console.error('Could not reject the delivery offer:', error);
      return response.status(503).json({ error: 'The delivery offer could not be updated right now.' });
    }
  }
  offer.rejectedByIds = [...new Set([...offer.rejectedByIds, request.user.id])];
  if (offer.rejectedByIds.length >= offer.riderIds.length) offer.status = 'REJECTED';
  writeStore();
  return response.json({ ok: true });
});

app.post('/api/stops/:id/assignment/cancel', requireUser, async (request, response) => {
  const stop = store.stops.find(item => item.id === request.params.id);
  if (!stop) return response.status(404).json({ error: 'Delivery not found.' });
  const isBusinessOwner = request.user.role === 'ADMIN' && stop.ownerAdminId === request.user.id;
  const isAssignedRider = request.user.role === 'DRIVER' && stop.assignedDriverId === request.user.id;
  if (!isBusinessOwner && !isAssignedRider) {
    return response.status(403).json({ error: 'You are not authorized to cancel this assignment.' });
  }
  if (!stop.assignedDriverId) {
    return response.status(409).json({ error: 'This delivery has no active rider assignment.' });
  }
  if (['DELIVERED', 'FAILED', 'CANCELLED'].includes(dispatchStatusFromStop(stop))) {
    return response.status(409).json({ error: 'A completed or terminal delivery cannot be reassigned.' });
  }

  const riderId = stop.assignedDriverId;
  const assignment = store.deliveryAssignments.find(item =>
    item.deliveryId === stop.id && item.riderId === riderId
    && !['CANCELLED', 'COMPLETED', 'REASSIGNED'].includes(item.status)
  );
  if (usesDatabase && !request.dispatchSchemaReady) {
    return response.status(409).json({
      error: 'Safe assignment release requires the dispatch schema migration before it can be enabled.'
    });
  }
  if (request.dispatchSchemaReady) {
    try {
      const { rows } = await databaseRequestClient.query(`
        UPDATE delivery_assignments
        SET status = 'CANCELLED', ended_at = NOW(), end_reason = 'CANCELLED_BY_PARTY'
        WHERE delivery_id = $1 AND rider_id = $2 AND status = 'ACTIVE'
        RETURNING assignment_id
      `, [stop.id, riderId]);
      if (rows.length !== 1) {
        return response.status(409).json({ error: 'This delivery no longer has an active assignment.' });
      }
      await databaseRequestClient.query(`
        INSERT INTO delivery_assignment_history
          (assignment_id, delivery_id, event_type, actor_id, details)
        VALUES ($1, $2, 'CANCELLED', $3, $4::jsonb)
      `, [
        rows[0].assignment_id,
        stop.id,
        request.user.id,
        JSON.stringify({ reason: 'CANCELLED_BY_PARTY' })
      ]);
      await databaseRequestClient.query(`
        UPDATE dispatch_offers
        SET status = 'CANCELLED', responded_at = NOW()
        WHERE delivery_id = $1 AND status IN ('PENDING', 'ACCEPTED')
      `, [stop.id]);
      await databaseRequestClient.query(`
        UPDATE dispatch_deliveries SET status = 'UNASSIGNED', updated_at = NOW()
        WHERE delivery_id = $1 AND business_id = $2
      `, [stop.id, stop.ownerAdminId]);
      await databaseRequestClient.query(`
        INSERT INTO delivery_status_history (delivery_id, status, actor_id)
        VALUES ($1, 'UNASSIGNED', $2)
      `, [stop.id, request.user.id]);
    } catch (error) {
      console.error('Could not cancel the delivery assignment:', error);
      return response.status(503).json({ error: 'The delivery assignment could not be released right now.' });
    }
  }

  const cancelledAt = new Date().toISOString();
  stop.assignedDriverId = '';
  stop.assignedAt = null;
  stop.acceptedAt = null;
  stop.dispatchStatus = 'UNASSIGNED';
  stop.dispatchStatusHistory = [
    ...(Array.isArray(stop.dispatchStatusHistory) ? stop.dispatchStatusHistory : []),
    { status: 'UNASSIGNED', at: cancelledAt, riderId }
  ];
  if (assignment) {
    assignment.status = 'CANCELLED';
    assignment.endedAt = cancelledAt;
    assignment.endReason = 'CANCELLED_BY_PARTY';
  }
  store.deliveryOffers = store.deliveryOffers.map(offer =>
    offer.stopId === stop.id && ['OPEN', 'ACCEPTED'].includes(offer.status)
      ? { ...offer, status: 'CLOSED' }
      : offer
  );
  const rider = store.users.find(user => user.id === riderId && user.role === 'DRIVER');
  if (rider) {
    const remainingStops = store.stops.filter(item =>
      item.assignedDriverId === riderId && !['DELIVERED', 'FAILED', 'UNDELIVERED', 'CANCELLED']
        .includes(String(item.status || '').toUpperCase())
    );
    rider.routeStopCount = remainingStops.length;
    if (remainingStops.length === 0) rider.routeStatus = 'IDLE';
    rider.routeUpdatedAt = cancelledAt;
  }
  writeStore();
  return response.json({ ok: true, deliveryStatus: 'UNASSIGNED' });
});

app.put('/api/stops', requireUser, async (request, response) => {
  const incomingStops = request.body.stops;
  if (!Array.isArray(incomingStops) || incomingStops.length > 500) {
    return response.status(400).json({ error: 'The route stop list is invalid.' });
  }
  const ownerAdminId = request.user.role === 'ADMIN' ? request.user.id : request.user.ownerAdminId;
  if (!ownerAdminId) return response.status(403).json({ error: 'This account has no fleet owner.' });

  for (const stop of incomingStops) {
    const quoteToken = typeof stop.pricingQuoteToken === 'string' ? stop.pricingQuoteToken : '';
    if (!quoteToken) continue;
    const validatedQuote = verifyPricingQuote(quoteToken, request.user.id);
    if (!validatedQuote) {
      return response.status(400).json({ error: 'The delivery price quote has expired or is invalid. Please request a fresh estimate before saving this delivery.' });
    }
    const expectedPrice = Number(stop.estimatedPriceNgn);
    const expectedDistance = Number(stop.routeDistanceKm);
    const expectedDuration = Number(stop.routeDurationMinutes);
    const quoteCurrency = cleanText(stop.pricingCurrency, 3).toUpperCase();
    if (!Number.isFinite(expectedPrice)
      || Math.round(expectedPrice * 100) !== Math.round(Number(validatedQuote.price) * 100)
      || !Number.isFinite(expectedDistance)
      || Math.abs(expectedDistance - Number(validatedQuote.distanceKm)) > 0.01
      || !Number.isFinite(expectedDuration)
      || Math.abs(expectedDuration - Number(validatedQuote.durationMinutes)) > 0.5
      || quoteCurrency !== cleanText(validatedQuote.currency, 3).toUpperCase()
      || Number(stop.pricingRuleVersion) !== Number(validatedQuote.ruleVersion)) {
      return response.status(400).json({ error: 'The delivery price quote does not match the current route. Please request a fresh estimate before confirming this delivery.' });
    }
  }

  const previousFleetStops = store.stops.filter(stop =>
    request.user.role === 'DRIVER'
      ? stop.assignedDriverId === request.user.id
      : stop.ownerAdminId === ownerAdminId
  );
  const previousFleetStopIds = new Set(previousFleetStops.map(stop => stop.id));
  const otherStops = store.stops.filter(stop => !previousFleetStopIds.has(stop.id));
  const previousStopsById = new Map(previousFleetStops.map(stop => [stop.id, stop]));
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
    const previousStop = previousStopsById.get(stop.id);
    if (request.user.role === 'ADMIN'
      && stop.assignedDriverId
      && stop.assignedDriverId !== previousStop?.assignedDriverId) {
      return response.status(409).json({
        error: 'Drivers must accept a delivery offer before assignment. Send an offer to the selected driver instead.'
      });
    }
    if (request.user.role === 'DRIVER'
      && (!previousStop || previousStop.assignedDriverId !== request.user.id || stop.assignedDriverId !== request.user.id)) {
      return response.status(403).json({ error: 'Drivers can only update deliveries assigned to them.' });
    }
    const hasAtomicAssignment = store.deliveryAssignments.some(assignment => assignment.deliveryId === stop.id);
    const isAcceptedDispatch = previousStop?.assignedDriverId && (
      hasAtomicAssignment
      || ['RIDER_ACCEPTED', 'HEADING_TO_PICKUP', 'HEADING_TO_DESTINATION', 'DELIVERED'].includes(previousStop.dispatchStatus)
    );
    const sanitizedStop = {
      ...stop,
      ownerAdminId: request.user.role === 'DRIVER' ? previousStop.ownerAdminId : ownerAdminId
    };
    if (isAcceptedDispatch) {
      sanitizedStop.assignedDriverId = previousStop.assignedDriverId;
      sanitizedStop.assignedAt = previousStop.assignedAt;
      sanitizedStop.acceptedAt = previousStop.acceptedAt;
      sanitizedStop.pickedUpAt = previousStop.pickedUpAt;
      sanitizedStop.pickupAddress = previousStop.pickupAddress;
      sanitizedStop.pickupLat = previousStop.pickupLat;
      sanitizedStop.pickupLng = previousStop.pickupLng;
      sanitizedStop.dispatchStatusHistory = previousStop.dispatchStatusHistory || [];
      if (request.user.role === 'ADMIN') {
        sanitizedStop.status = previousStop.status;
        sanitizedStop.dispatchStatus = previousStop.dispatchStatus;
      } else if (stop.assignedDriverId !== request.user.id) {
        return response.status(403).json({ error: 'Drivers can only update their own accepted delivery.' });
      } else if (previousStop.dispatchStatus === 'DELIVERED') {
        sanitizedStop.status = 'DELIVERED';
        sanitizedStop.dispatchStatus = 'DELIVERED';
        sanitizedStop.deliveredAt = previousStop.deliveredAt;
      } else if (stop.status === 'DELIVERED') {
        sanitizedStop.dispatchStatus = 'DELIVERED';
        sanitizedStop.deliveredAt = stop.deliveredAt || new Date().toISOString();
        sanitizedStop.dispatchStatusHistory = [
          ...sanitizedStop.dispatchStatusHistory,
          { status: 'DELIVERED', at: sanitizedStop.deliveredAt, riderId: request.user.id }
        ];
      } else {
        sanitizedStop.dispatchStatus = previousStop.dispatchStatus;
      }
    }
    sanitizedStops.push(sanitizedStop);
  }

  const omittedAcceptedStops = previousFleetStops.filter(stop =>
    stop.assignedDriverId
    && (store.deliveryAssignments.some(assignment => assignment.deliveryId === stop.id)
      || ['RIDER_ACCEPTED', 'HEADING_TO_PICKUP', 'HEADING_TO_DESTINATION'].includes(stop.dispatchStatus))
    && !sanitizedStops.some(item => item.id === stop.id)
  );
  if (request.user.role === 'ADMIN') {
    sanitizedStops.push(...omittedAcceptedStops);
  } else if (omittedAcceptedStops.some(stop => stop.assignedDriverId === request.user.id)) {
    return response.status(403).json({ error: 'Accepted deliveries cannot be removed from a rider route.' });
  }

  store.stops = [...otherStops, ...sanitizedStops];
  const newlyAssignedStopIds = new Set(store.stops
    .filter(stop => stop.ownerAdminId === ownerAdminId && stop.assignedDriverId)
    .map(stop => stop.id));
  store.deliveryOffers = store.deliveryOffers.map(offer =>
    offer.ownerAdminId === ownerAdminId
      && offer.status === 'OPEN'
      && newlyAssignedStopIds.has(offer.stopId)
      ? { ...offer, status: 'CLOSED' }
      : offer
  );
  const retainedStopIds = new Set(store.stops.map(stop => stop.id));
  store.deliveryOffers = store.deliveryOffers.map(offer =>
    offer.ownerAdminId === ownerAdminId && offer.status === 'OPEN' && !retainedStopIds.has(offer.stopId)
      ? { ...offer, status: 'CLOSED' }
      : offer
  );

  for (const driver of request.user.role === 'DRIVER' ? [request.user] : ownedDrivers) {
    const driverStops = store.stops.filter(stop =>
      stop.assignedDriverId === driver.id
      && (request.user.role === 'DRIVER' || stop.ownerAdminId === ownerAdminId)
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
  if (request.dispatchSchemaReady) {
    try {
      for (const stop of sanitizedStops) await syncDispatchDelivery(databaseRequestClient, stop);
    } catch (error) {
      console.error('Could not synchronize dispatch deliveries:', error);
      return response.status(503).json({ error: 'The delivery route could not be saved right now.' });
    }
  }
  writeStore();
  const users = store.users.filter(user =>
    user.id === ownerAdminId || user.ownerAdminId === ownerAdminId
  );
  return response.json({ stops: sanitizedStops, users: users.map(user => publicUserForViewer(user, request.user)) });
});

app.patch('/api/users/me/availability', requireUser, async (request, response) => {
  if (request.user.role !== 'DRIVER') {
    return response.status(403).json({ error: 'Only driver accounts can change rider availability.' });
  }
  if (typeof request.body.isAvailable !== 'boolean') {
    return response.status(400).json({ error: 'The rider availability value is invalid.' });
  }
  const driver = store.users.find(user => user.id === request.user.id && user.role === 'DRIVER');
  if (!driver) return response.status(404).json({ error: 'Driver account not found.' });
  if (request.body.isAvailable && driver.status !== 'ACTIVE') {
    return response.status(403).json({ error: 'Your driver account must be approved before going online.' });
  }

  driver.isAvailable = request.body.isAvailable;
  driver.availabilityUpdatedAt = new Date().toISOString();
  if (request.dispatchSchemaReady) {
    try {
      await databaseRequestClient.query(`
        INSERT INTO rider_dispatch_profiles
          (rider_id, is_active, is_available, vehicle_type, zone_id, max_package_size,
           max_package_weight_kg, max_package_count, accepts_cross_business_batches, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
        ON CONFLICT (rider_id)
        DO UPDATE SET is_active = EXCLUDED.is_active,
          is_available = EXCLUDED.is_available,
          vehicle_type = EXCLUDED.vehicle_type,
          zone_id = EXCLUDED.zone_id,
          max_package_size = EXCLUDED.max_package_size,
          max_package_weight_kg = EXCLUDED.max_package_weight_kg,
          max_package_count = EXCLUDED.max_package_count,
          accepts_cross_business_batches = EXCLUDED.accepts_cross_business_batches,
          updated_at = NOW()
      `, [
        driver.id, driver.status === 'ACTIVE', driver.isAvailable, driver.vehicleType || null,
        driver.zone || null, driver.maxPackageSize || null, driver.maxPackageWeightKg || null,
        driver.maxPackageCount || null, driver.acceptsCrossBusinessBatches === true
      ]);
    } catch (error) {
      console.error('Could not update structured rider availability:', error);
      return response.status(503).json({ error: 'Rider availability could not be updated right now.' });
    }
  }
  writeStore();
  return response.json({ user: publicUserForViewer(driver, request.user) });
});

app.patch('/api/users/me/dispatch-profile', requireUser, async (request, response) => {
  if (request.user.role !== 'DRIVER') {
    return response.status(403).json({ error: 'Only a rider can update dispatch capacity and consent.' });
  }
  const { maxPackageCount, maxPackageWeightKg, maxPackageSize, acceptsCrossBusinessBatches } = request.body;
  const validSizes = new Set(['SMALL', 'MEDIUM', 'LARGE']);
  if ((maxPackageCount !== null && (!Number.isInteger(maxPackageCount) || maxPackageCount < 1 || maxPackageCount > 100))
    || (maxPackageWeightKg !== null && (!Number.isFinite(maxPackageWeightKg) || maxPackageWeightKg <= 0 || maxPackageWeightKg > 1000))
    || (maxPackageSize !== null && !validSizes.has(maxPackageSize))
    || typeof acceptsCrossBusinessBatches !== 'boolean') {
    return response.status(400).json({ error: 'Enter valid package capacity values and explicit cross-business consent.' });
  }
  if (!request.dispatchSchemaReady) {
    return response.status(503).json({ error: 'Structured dispatch profiles are not available until the dispatch migrations are applied.' });
  }
  const rider = store.users.find(user => user.id === request.user.id && user.role === 'DRIVER');
  if (!rider) return response.status(404).json({ error: 'Rider account not found.' });
  Object.assign(rider, {
    maxPackageCount,
    maxPackageWeightKg,
    maxPackageSize,
    acceptsCrossBusinessBatches
  });
  try {
    await databaseRequestClient.query(`
      INSERT INTO rider_dispatch_profiles (
        rider_id, is_active, is_available, vehicle_type, zone_id, max_package_size,
        max_package_weight_kg, max_package_count, accepts_cross_business_batches, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
      ON CONFLICT (rider_id)
      DO UPDATE SET
        is_active = EXCLUDED.is_active,
        is_available = EXCLUDED.is_available,
        vehicle_type = EXCLUDED.vehicle_type,
        zone_id = EXCLUDED.zone_id,
        max_package_size = EXCLUDED.max_package_size,
        max_package_weight_kg = EXCLUDED.max_package_weight_kg,
        max_package_count = EXCLUDED.max_package_count,
        accepts_cross_business_batches = EXCLUDED.accepts_cross_business_batches,
        updated_at = NOW()
    `, [
      rider.id, rider.status === 'ACTIVE', rider.isAvailable === true, rider.vehicleType || null,
      rider.zone || null, maxPackageSize, maxPackageWeightKg, maxPackageCount, acceptsCrossBusinessBatches
    ]);
  } catch (error) {
    console.error('Could not update rider dispatch capacity and consent:', error);
    return response.status(503).json({ error: 'Rider dispatch profile could not be saved right now.' });
  }
  writeStore();
  return response.json({ user: publicUserForViewer(rider, request.user) });
});

app.get('/api/dispatch/business-preferences', requireUser, requireAdmin, async (request, response) => {
  if (!request.dispatchSchemaReady) {
    return response.status(503).json({ error: 'Structured dispatch preferences are unavailable until migrations are applied.' });
  }
  try {
    const { rows } = await databaseRequestClient.query(`
      SELECT allows_cross_business_batch
      FROM dispatch_business_batch_preferences
      WHERE business_id = $1
    `, [request.user.id]);
    return response.json({ allowsCrossBusinessBatch: rows[0]?.allows_cross_business_batch === true });
  } catch (error) {
    console.error('Could not load business dispatch preferences:', error);
    return response.status(503).json({ error: 'Business dispatch preferences are temporarily unavailable.' });
  }
});

app.patch('/api/dispatch/business-preferences', requireUser, requireAdmin, async (request, response) => {
  if (typeof request.body.allowsCrossBusinessBatch !== 'boolean') {
    return response.status(400).json({ error: 'Cross-business batching consent must be explicitly enabled or disabled.' });
  }
  if (!request.dispatchSchemaReady) {
    return response.status(503).json({ error: 'Structured dispatch preferences are unavailable until migrations are applied.' });
  }
  try {
    await databaseRequestClient.query(`
      INSERT INTO dispatch_business_batch_preferences (business_id, allows_cross_business_batch)
      VALUES ($1, $2)
      ON CONFLICT (business_id)
      DO UPDATE SET allows_cross_business_batch = EXCLUDED.allows_cross_business_batch,
        updated_at = NOW()
    `, [request.user.id, request.body.allowsCrossBusinessBatch]);
  } catch (error) {
    console.error('Could not update business dispatch preferences:', error);
    return response.status(503).json({ error: 'Business dispatch preferences could not be saved.' });
  }
  return response.json({ allowsCrossBusinessBatch: request.body.allowsCrossBusinessBatch });
});

app.patch('/api/users/me/location', requireUser, async (request, response) => {
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
  if (!user) return response.status(404).json({ error: 'Driver account not found.' });
  if (isTracking && user.status !== 'ACTIVE') {
    return response.status(403).json({ error: 'Your driver account must be approved before sharing a marketplace location.' });
  }
  user.isTracking = isTracking;
  user.locationUpdatedAt = isTracking ? new Date().toISOString() : null;
  if (isTracking) Object.assign(user, { lat, lng, speed });
  else {
    user.lat = null;
    user.lng = null;
    user.speed = 0;
  }
  if (request.dispatchSchemaReady) {
    try {
      await databaseRequestClient.query(`
        INSERT INTO rider_dispatch_profiles
          (rider_id, is_active, is_available, vehicle_type, zone_id, updated_at)
        VALUES ($1, $2, $3, $4, $5, NOW())
        ON CONFLICT (rider_id)
        DO UPDATE SET is_active = EXCLUDED.is_active,
          is_available = EXCLUDED.is_available,
          vehicle_type = EXCLUDED.vehicle_type,
          zone_id = EXCLUDED.zone_id, updated_at = NOW()
      `, [
        user.id, user.status === 'ACTIVE', user.isAvailable === true,
        user.vehicleType || null, user.zone || null
      ]);
      if (isTracking) {
        await databaseRequestClient.query(`
          INSERT INTO rider_current_locations
            (rider_id, latitude, longitude, recorded_at, sharing_enabled)
          VALUES ($1, $2, $3, NOW(), TRUE)
          ON CONFLICT (rider_id)
          DO UPDATE SET latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
            recorded_at = NOW(), sharing_enabled = TRUE
        `, [user.id, lat, lng]);
        const { rows: activeAssignments } = await databaseRequestClient.query(`
          SELECT delivery_id FROM delivery_assignments
          WHERE rider_id = $1 AND status = 'ACTIVE'
          ORDER BY assigned_at DESC LIMIT 1
        `, [user.id]);
        const activeDeliveryId = activeAssignments[0]?.delivery_id || null;
        if (activeDeliveryId || user.isAvailable === true) {
          await databaseRequestClient.query(`
            INSERT INTO rider_location_history (
              rider_id, delivery_id, latitude, longitude, context, recorded_at
            )
            VALUES ($1, $2, $3, $4, $5, NOW())
          `, [
            user.id,
            activeDeliveryId,
            lat,
            lng,
            activeDeliveryId ? 'ACTIVE_DELIVERY' : 'AVAILABLE_FOR_MATCHING'
          ]);
        }
      } else {
        await databaseRequestClient.query(`
          UPDATE rider_current_locations
          SET sharing_enabled = FALSE
          WHERE rider_id = $1
        `, [user.id]);
      }
    } catch (error) {
      console.error('Could not store structured rider location:', error);
      return response.status(503).json({ error: 'Rider location could not be updated right now.' });
    }
  }
  writeStore();
  const activeDelivery = store.stops.find(stop =>
    (usesDatabase ? stop.ownerAdminId === user.ownerAdminId : true)
    &&
    stop.assignedDriverId === user.id
    && ['RIDER_ASSIGNED', 'RIDER_ACCEPTED', 'HEADING_TO_PICKUP', 'ARRIVED_AT_PICKUP', 'HEADING_TO_DESTINATION']
      .includes(stop.dispatchStatus)
  );
  const locationEvent = {
    id: user.id,
    name: user.name,
    vehicle: user.vehicle || '',
    zone: user.zone || '',
    lat: user.lat,
    lng: user.lng,
    speed: user.speed || 0,
    isTracking: user.isTracking,
    isAvailable: user.isAvailable === true && !activeDelivery,
    assigned: Boolean(activeDelivery),
    deliveryId: activeDelivery?.id || null,
    dispatchStatus: activeDelivery?.dispatchStatus || null,
    locationUpdatedAt: user.locationUpdatedAt,
    publicMarket: user.isAvailable === true && !activeDelivery && user.isTracking
  };
  if (user.isAvailable === true && !activeDelivery && user.isTracking) {
    response.once('finish', () => {
      if (response.statusCode < 400) {
        io.to('marketplace:businesses').emit('driver:location', locationEvent);
      }
    });
  } else {
    response.once('finish', () => {
      if (response.statusCode < 400) {
        io.to('marketplace:businesses').emit('driver:unavailable', { id: user.id });
      }
    });
  }
  if (activeDelivery) {
    response.once('finish', () => {
      if (response.statusCode < 400) {
        io.to(`business:${activeDelivery.ownerAdminId}`).emit('driver:location', {
          ...locationEvent,
          businessId: activeDelivery.ownerAdminId,
          publicMarket: false
        });
      }
    });
  }
  return response.json({ user: publicUser(user) });
});

app.patch('/api/users/:id/route-status', requireUser, async (request, response) => {
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
  if (isDriverSelf && routeStatus === 'IN_PROGRESS') {
    const startedAt = driver.routeUpdatedAt;
    for (const stop of store.stops.filter(item =>
      item.assignedDriverId === driver.id && item.dispatchStatus === 'RIDER_ACCEPTED'
    )) {
      stop.dispatchStatus = 'HEADING_TO_PICKUP';
      stop.dispatchStatusHistory = [
        ...(Array.isArray(stop.dispatchStatusHistory) ? stop.dispatchStatusHistory : []),
        { status: 'HEADING_TO_PICKUP', at: startedAt, riderId: driver.id }
      ];
    }
  }
  if (Number.isInteger(routeStopCount) && routeStopCount >= 0 && routeStopCount <= 500) {
    driver.routeStopCount = routeStopCount;
  }
  if (request.dispatchSchemaReady) {
    try {
      for (const stop of store.stops.filter(item => item.assignedDriverId === driver.id)) {
        await syncDispatchDelivery(databaseRequestClient, stop);
      }
      await databaseRequestClient.query(`
        UPDATE rider_dispatch_profiles
        SET is_available = $2, updated_at = NOW()
        WHERE rider_id = $1
      `, [driver.id, driver.isAvailable === true && routeStatus === 'IDLE']);
    } catch (error) {
      console.error('Could not synchronize rider route status:', error);
      return response.status(503).json({ error: 'The rider route status could not be updated right now.' });
    }
  }
  writeStore();
  return response.json({
    user: publicUserForViewer(driver, request.user),
    stops: store.stops.filter(stop => stop.assignedDriverId === driver.id)
  });
});

app.patch('/api/stops/:id/pickup', requireUser, async (request, response) => {
  if (request.user.role !== 'DRIVER') {
    return response.status(403).json({ error: 'Only the assigned rider can confirm package pickup.' });
  }
  const stop = store.stops.find(item =>
    item.id === request.params.id
    && item.assignedDriverId === request.user.id
  );
  if (!stop) return response.status(404).json({ error: 'This delivery is not assigned to you.' });
  if (stop.dispatchStatus !== 'HEADING_TO_PICKUP') {
    return response.status(409).json({ error: 'Start the delivery journey before confirming package pickup.' });
  }
  const pickedUpAt = new Date().toISOString();
  stop.status = 'IN_PROGRESS';
  stop.dispatchStatus = 'HEADING_TO_DESTINATION';
  stop.pickedUpAt = pickedUpAt;
  stop.dispatchStatusHistory = [
    ...(Array.isArray(stop.dispatchStatusHistory) ? stop.dispatchStatusHistory : []),
    { status: 'HEADING_TO_DESTINATION', at: pickedUpAt, riderId: request.user.id }
  ];
  if (request.dispatchSchemaReady) {
    try {
      await syncDispatchDelivery(databaseRequestClient, stop);
      await databaseRequestClient.query(`
        INSERT INTO delivery_status_history (delivery_id, status, actor_id)
        VALUES ($1, 'HEADING_TO_DESTINATION', $2)
      `, [stop.id, request.user.id]);
    } catch (error) {
      console.error('Could not record package pickup in dispatch storage:', error);
      return response.status(503).json({ error: 'Package pickup could not be recorded right now.' });
    }
  }
  writeStore();
  return response.json({ stop });
});

app.post('/api/stops/:id/proof', requireUser, async (request, response) => {
  if (request.user.role !== 'DRIVER') {
    return response.status(403).json({ error: 'Only the assigned rider can submit delivery proof.' });
  }
  if (!request.dispatchSchemaReady) {
    return response.status(503).json({ error: 'Structured proof records are unavailable until dispatch migrations are applied.' });
  }
  const stop = store.stops.find(item =>
    item.id === request.params.id && item.assignedDriverId === request.user.id
  );
  if (!stop) return response.status(404).json({ error: 'This delivery is not assigned to you.' });
  if (stop.dispatchStatus !== 'HEADING_TO_DESTINATION') {
    return response.status(409).json({ error: 'Confirm package pickup before submitting delivery proof.' });
  }
  const customerName = cleanText(request.body.customerName, 120);
  const driverNotes = cleanText(request.body.driverNotes, 1000);
  const signature = request.body.customerSignature;
  const photo = request.body.customerPhoto || '';
  if (!customerName
    || typeof signature !== 'string'
    || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(signature)
    || signature.length > 1_500_000
    || (photo && (typeof photo !== 'string'
      || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(photo)
      || photo.length > 5_000_000))) {
    return response.status(400).json({ error: 'Provide a recipient name, valid signature, and an optional supported image under 5 MB.' });
  }
  const proofTime = new Date().toISOString();
  const completedStop = {
    ...stop,
    status: 'DELIVERED',
    dispatchStatus: 'DELIVERED',
    customerName,
    driverNotes,
    customerSignature: signature,
    customerPhoto: photo,
    deliveredAt: proofTime
  };
  try {
    await databaseRequestClient.query('SAVEPOINT dispatch_delivery_proof');
    const { rows: assignmentRows } = await databaseRequestClient.query(`
      SELECT assignment_id
      FROM delivery_assignments
      WHERE delivery_id = $1 AND rider_id = $2 AND status = 'ACTIVE'
      FOR UPDATE
    `, [stop.id, request.user.id]);
    if (!assignmentRows.length) {
      await databaseRequestClient.query('ROLLBACK TO SAVEPOINT dispatch_delivery_proof');
      return response.status(409).json({ error: 'This delivery no longer has an active assignment.' });
    }
    await databaseRequestClient.query(`
      INSERT INTO delivery_proofs
        (proof_id, delivery_id, assignment_id, rider_id, proof_type, details, captured_at)
      VALUES ($1, $2, $3, $4, 'SIGNATURE', $5::jsonb, $6)
    `, [
      crypto.randomUUID(),
      stop.id,
      assignmentRows[0].assignment_id,
      request.user.id,
      JSON.stringify({
        customerName,
        driverNotes,
        customerSignature: signature,
        customerPhoto: photo || null
      }),
      proofTime
    ]);
    store.stops = store.stops.map(item => item.id === stop.id ? completedStop : item);
    await syncDispatchDelivery(databaseRequestClient, completedStop);
    const driver = store.users.find(user => user.id === request.user.id && user.role === 'DRIVER');
    if (driver) {
      const activeStatuses = new Set([
        'RIDER_ASSIGNED', 'RIDER_ACCEPTED', 'HEADING_TO_PICKUP',
        'ARRIVED_AT_PICKUP', 'HEADING_TO_DESTINATION'
      ]);
      const remainingActiveStops = store.stops.filter(item =>
        item.assignedDriverId === driver.id && activeStatuses.has(dispatchStatusFromStop(item))
      );
      driver.routeStatus = remainingActiveStops.length ? 'IN_PROGRESS' : 'IDLE';
      driver.routeStopCount = remainingActiveStops.length;
      driver.routeUpdatedAt = proofTime;
    }
    await databaseRequestClient.query('RELEASE SAVEPOINT dispatch_delivery_proof');
  } catch (error) {
    try {
      await databaseRequestClient.query('ROLLBACK TO SAVEPOINT dispatch_delivery_proof');
    } catch (rollbackError) {
      console.error('Could not roll back delivery proof submission:', rollbackError);
    }
    console.error('Could not save independent delivery proof:', error);
    return response.status(503).json({ error: 'Delivery proof could not be saved right now.' });
  }
  writeStore();
  const completedDriver = store.users.find(user => user.id === request.user.id && user.role === 'DRIVER');
  return response.status(201).json({ stop: completedStop, user: completedDriver ? publicUser(completedDriver) : null });
});

app.delete('/api/users/:id', requireUser, requireAdmin, async (request, response) => {
  const driver = store.users.find(user =>
    user.id === request.params.id &&
    user.role === 'DRIVER' &&
    user.ownerAdminId === request.user.id
  );
  if (!driver) return response.status(404).json({ error: 'Driver not found in your fleet.' });
  const activeAcceptedDeliveries = store.stops.filter(stop =>
    stop.assignedDriverId === driver.id
    && ['RIDER_ACCEPTED', 'HEADING_TO_PICKUP', 'HEADING_TO_DESTINATION'].includes(stop.dispatchStatus)
  );
  if (activeAcceptedDeliveries.length > 0) {
    return response.status(409).json({ error: 'This rider cannot be removed while an accepted delivery is active.' });
  }
  if (request.dispatchSchemaReady) {
    try {
      await databaseRequestClient.query(`
        UPDATE rider_dispatch_profiles
        SET is_active = FALSE, is_available = FALSE, updated_at = NOW()
        WHERE rider_id = $1
      `, [driver.id]);
      await databaseRequestClient.query(`
        UPDATE dispatch_business_riders
        SET active = FALSE
        WHERE rider_id = $1
      `, [driver.id]);
      await databaseRequestClient.query(`
        UPDATE rider_current_locations
        SET sharing_enabled = FALSE
        WHERE rider_id = $1
      `, [driver.id]);
      await databaseRequestClient.query(`
        UPDATE dispatch_offers
        SET status = 'CANCELLED', responded_at = NOW()
        WHERE rider_id = $1 AND status = 'PENDING'
      `, [driver.id]);
    } catch (error) {
      console.error('Could not deactivate the deleted rider in dispatch storage:', error);
      return response.status(503).json({ error: 'The rider could not be removed right now.' });
    }
  }
  store.deliveryOffers = store.deliveryOffers.map(offer => {
    if (offer.status !== 'OPEN' || !offer.riderIds.includes(driver.id)) return offer;
    const remainingRiderIds = offer.riderIds.filter(riderId => riderId !== driver.id);
    return {
      ...offer,
      riderIds: remainingRiderIds,
      rejectedByIds: offer.rejectedByIds.filter(riderId => riderId !== driver.id),
      ...(remainingRiderIds.length === 0 ? { status: 'CLOSED' } : {})
    };
  });
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
  httpServer.listen(port, '0.0.0.0', () => {
    console.log(`Tobs Route Circuit server listening on port ${port}.`);
  });
}
