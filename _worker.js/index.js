import { json, logActivity, generateAccessToken, normalizeName, validateSession, PATH_PERMISSION_MAP, API_PERMISSION_MAP, getPermissionKey, hasPermission, safeJsonParse } from './lib/core.js';
import { dispatchNotification } from './lib/push.js';
import { handleApiLoadingBays, handleApiLoadingAssignments, handleApiLoadingPhotos } from './routes/loading.js';
import { handleApiBolCustomersSeed, handleApiBolCustomers, handleApiBolCarriers, handleApiBols,
         handleApiPartsSeed, handleApiLoadBuilderSkusDeleteAll, handleApiLoadBuilderSkus,
         handleApiSavedLoads } from './routes/bols.js';
import { handleApiJobs, handleApiShipments } from './routes/jobs.js';
import { handleApiCutting } from './routes/cutting.js';
import { handleApiParts, handleApiCombos, handleApiBeadTypes, handleApiBeadStock,
         handleApiBlockInventory, handleApiMoldingLog, handleApiBlockConsumption } from './routes/production.js';
import { handleApiCompletions, handleApiScrapLog } from './routes/qc.js';
import { handleApiReportsScrapSummary, handleApiReportsScrapTrend, handleApiReportsScrapReasons,
         handleIncidentTrend, handleIncidentSummary, handleIncidentList, handleIncidentDetail } from './routes/reports.js';
import { handleApiUsers, handleApiRoles, handleApiActivityLog } from './routes/admin.js';
import { handleAuthLogin, handleAuthLogout, handleAuthMe, handleAuthChangePassword,
         handleSimulateRoleStart, handleSimulateRoleStop } from './routes/auth.js';
import { handleApiNotifications, handleApiPushSubscribe, handleApiPushUnsubscribe } from './routes/notifications.js';
import { handleApiPublicBolLookup, handleApiPublicBolPickup, handleApiPublicBolDelivery, handleApiPublicBolDocument } from './routes/public.js';
import { handleApiQuickbooks, handleApiQbWebhook } from './routes/quickbooks.js';

// _worker.js — Pages Advanced Mode with SAFE error reporting

// ─────────────────────────────────────────────────────────────────────────────
// F2 — API ROUTE TABLE (Worker Router Abstraction)
// Replaces the flat if/else dispatch chain. Match order = declaration order.
// Match types:
//   { path: '/api/x', handler: fn }                 — exact path match
//   { prefix: '/api/x', handler: fn }               — exact OR startsWith(prefix + '/')
//   { path: '/api/x', method: 'POST', handler: fn } — method-scoped exact match
//
// Adding a new route: add one row. Order matters only for prefix overlaps —
// place more specific paths before more general prefixes.
//
// NOTE: Auth routes (/api/auth/*) and /api/push/vapid-public-key are NOT in
// this table — they bypass the session gate and are handled inline above it.
// ─────────────────────────────────────────────────────────────────────────────
const API_ROUTES = [
  // Admin
  { prefix: '/api/users', handler: (req, env) => handleApiUsers(req, env) },
  { prefix: '/api/roles', handler: (req, env) => handleApiRoles(req, env) },

  // QC
  { path: '/api/completions', handler: (req, env) => handleApiCompletions(req, env) },
  { path: '/api/scrap-log',   handler: (req, env) => handleApiScrapLog(req, env) },

  // Reports (scrap)
  { path: '/api/reports/scrap-summary', handler: (req, env) => handleApiReportsScrapSummary(req, env) },
  { path: '/api/reports/scrap-trend',   handler: (req, env) => handleApiReportsScrapTrend(req, env) },
  { path: '/api/reports/scrap-reasons', handler: (req, env) => handleApiReportsScrapReasons(req, env) },

  // Reports (incidents)
  { path: '/api/reports/incidents-trend',   handler: (req, env) => handleIncidentTrend(req, env) },
  { path: '/api/reports/incidents-summary', handler: (req, env) => handleIncidentSummary(req, env) },
  { path: '/api/reports/incidents-list',    handler: (req, env) => handleIncidentList(req, env) },
  { path: '/api/reports/incidents-detail',  handler: (req, env) => handleIncidentDetail(req, env) },

  // Parts / production
  { path: '/api/parts',             handler: (req, env) => handleApiParts(req, env) },
  { path: '/api/combos',            handler: (req, env) => handleApiCombos(req, env) },
  { path: '/api/bead-types',        handler: (req, env) => handleApiBeadTypes(req, env) },
  { path: '/api/bead-stock',        handler: (req, env) => handleApiBeadStock(req, env) },
  { path: '/api/block-inventory',   handler: (req, env) => handleApiBlockInventory(req, env) },
  { path: '/api/molding-log',       handler: (req, env) => handleApiMoldingLog(req, env) },
  { path: '/api/block-consumption', handler: (req, env) => handleApiBlockConsumption(req, env) },

  // QuickBooks integration
  { prefix: '/api/qb', handler: (req, env) => handleApiQuickbooks(req, env) },

  // Jobs / shipments / manufacturing
  { prefix: '/api/jobs',      handler: (req, env) => handleApiJobs(req, env) },
  { path:   '/api/shipments', handler: (req, env) => handleApiShipments(req, env) },
  { prefix: '/api/cutting',   handler: (req, env) => handleApiCutting(req, env) },

  // BOL / load builder (specific paths before their shared prefixes)
  { path:   '/api/bol-customers/seed',     handler: (req, env) => handleApiBolCustomersSeed(req, env) },
  { path:   '/api/bol-customers',          handler: (req, env) => handleApiBolCustomers(req, env) },
  { path:   '/api/bol-carriers',           handler: (req, env) => handleApiBolCarriers(req, env) },
  { prefix: '/api/bols',                   handler: (req, env) => handleApiBols(req, env) },
  { path:   '/api/load-builder-skus/seed', handler: (req, env) => handleApiPartsSeed(req, env) },
  { path:   '/api/load-builder-skus/all',  handler: (req, env) => handleApiLoadBuilderSkusDeleteAll(req, env) },
  { prefix: '/api/load-builder-skus',      handler: (req, env) => handleApiLoadBuilderSkus(req, env) },
  { prefix: '/api/saved-loads',            handler: (req, env) => handleApiSavedLoads(req, env) },

  // Admin utilities
  { path: '/api/admin/r2-backfill', method: 'POST', handler: (req, env) => handleApiAdminR2Backfill(req, env) },

  // Loading
  { prefix: '/api/loading-bays',        handler: (req, env) => handleApiLoadingBays(req, env) },
  { prefix: '/api/loading-assignments', handler: (req, env) => handleApiLoadingAssignments(req, env) },
  { prefix: '/api/loading-photos',      handler: (req, env) => handleApiLoadingPhotos(req, env) },

  // Platform
  { prefix: '/api/activity-log',  handler: (req, env) => handleApiActivityLog(req, env) },
  { prefix: '/api/notifications',  handler: (req, env) => handleApiNotifications(req, env) },

  // Push (subscribe/unsubscribe — vapid-public-key stays inline above the session gate)
  { path: '/api/push/subscribe',   handler: (req, env) => handleApiPushSubscribe(req, env) },
  { path: '/api/push/unsubscribe', handler: (req, env) => handleApiPushUnsubscribe(req, env) },

  // Public — no auth required (gated only by unguessable access_token).
  { prefix: '/api/public/bol-lookup',   handler: (req, env) => handleApiPublicBolLookup(req, env) },
  { prefix: '/api/public/bol-pickup',   handler: (req, env) => handleApiPublicBolPickup(req, env) },
  { prefix: '/api/public/bol-delivery', handler: (req, env) => handleApiPublicBolDelivery(req, env) },
  { prefix: '/api/public/bol-document', handler: (req, env) => handleApiPublicBolDocument(req, env) },
];

async function dispatchApiRoute(request, env, url) {
  const path = url.pathname;
  const method = request.method;
  for (const route of API_ROUTES) {
    if (route.method && route.method !== method) continue;
    if (route.path) {
      if (path === route.path) return await route.handler(request, env);
    } else if (route.prefix) {
      if (path === route.prefix || path.startsWith(route.prefix + '/')) {
        return await route.handler(request, env);
      }
    }
  }
  return null; // no match — falls through to static-asset / 404 handling
}

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);

      // 🔥 Training redirect safety net
      if (url.pathname === "/training" || url.pathname === "/training/") {
        return Response.redirect(`${url.origin}/safety/training/`, 301);
      }

      // 1) Health check
      if (url.pathname === "/health") {
        return new Response("FUNCTIONS_OK", { status: 200 });
      }

      // TEMPORARY host redirect: old Pages domain → canonical domain.
      // 302 (NOT 301) so it is not hard-cached and can be cleanly removed.
      // REMOVE this block once all internal links/bookmarks point at the canonical host.
      // NOTE: set CANONICAL_ORIGIN to the host where login sets xpanda_session (apex vs www).
      if (url.hostname === "xpanda-ops-platform.pages.dev") {
        const CANONICAL_ORIGIN = "https://www.xpandaops.com"; // ← confirm apex vs www
        return Response.redirect(CANONICAL_ORIGIN + url.pathname + url.search, 302);
      }

      // 2) Static asset passthrough — must come before session gate
      const STATIC_EXT = /\.(png|jpe?g|gif|svg|ico|webp|css|js|woff2?|ttf|eot|map|pdf)$/i;
      const STATIC_PREFIX = ['/logo/', '/assets/', '/logistics/assets/', '/qc-assets/'];
      const isStaticAsset = STATIC_EXT.test(url.pathname) ||
        STATIC_PREFIX.some(p => url.pathname.startsWith(p));

      // 3) Auth API routes (always accessible)
      if (url.pathname === '/api/auth/login') return handleAuthLogin(request, env);
      if (url.pathname === '/api/auth/logout') return handleAuthLogout(request, env);
      if (url.pathname === '/api/auth/me') return handleAuthMe(request, env);
      if (url.pathname === '/api/auth/change-password') return handleAuthChangePassword(request, env);
      if (url.pathname === '/api/auth/simulate-role' && request.method === 'POST') return handleSimulateRoleStart(request, env);
      if (url.pathname === '/api/auth/simulate-role' && request.method === 'DELETE') return handleSimulateRoleStop(request, env);

      // 4) Login page (serve without auth check)
      if (url.pathname === '/login' || url.pathname === '/login.html') {
        return env.ASSETS.fetch(request);
      }

      if (url.pathname === '/sw.js') {
        return env.ASSETS.fetch(request);
      }

      if (url.pathname === '/manifest.json') {
        return env.ASSETS.fetch(request);
      }

      if (url.pathname === '/api/push/vapid-public-key') {
        return json({ ok: true, key: env.VAPID_PUBLIC_KEY || '' });
      }

      // Public BOL tracking surface (no auth — drivers aren't platform users).
      if (url.pathname === '/track' || url.pathname === '/track/' || url.pathname.startsWith('/track/')) {
        return env.ASSETS.fetch(new Request(new URL('/track/index.html', url.origin).toString()));
      }

      // QBO webhook — bypasses session gate; verified by HMAC-SHA256 signature inside handler.
      if (url.pathname === '/api/qb/webhook' && request.method === 'POST') {
        return handleApiQbWebhook(request, env, ctx);
      }

      // /api/public/* bypasses the session gate; the handler enforces its own
      // access control via the unguessable access_token in the path.
      const isPublicApi = url.pathname.startsWith('/api/public/');

      // 5) Session gate — redirect unauthenticated users
      if (!isStaticAsset && !isPublicApi) {
        const db = env.DB;
        if (db) {
          const user = await validateSession(db, request);
          if (!user) {
            if (url.pathname.startsWith('/api/')) {
              return json({ ok: false, error: 'Unauthorized' }, 401);
            }
            return Response.redirect(`${url.origin}/login.html`, 302);
          }

          // ── Permission check ─────────────────────────────────────────────
          const isApi = url.pathname.startsWith('/api/');
          const permKey = getPermissionKey(url.pathname, isApi);

          // Escape hatch: real admins always access admin/auth paths even when simulating
          const ESCAPE_PREFIXES = ['/admin/', '/api/auth/', '/api/roles', '/api/users', '/api/activity-log', '/login'];
          const isEscapePath = user.isRealAdmin && ESCAPE_PREFIXES.some(p => url.pathname.startsWith(p));

          if (permKey && !isEscapePath) {
            const requiredAction = (request.method === 'GET' || request.method === 'HEAD') ? 'view' : 'edit';
            if (!hasPermission(user, permKey, requiredAction)) {
              if (isApi) {
                return json({ ok: false, error: 'Access denied. Insufficient permissions.' }, 403);
              }
              return Response.redirect(`${url.origin}/?access_denied=1`, 302);
            }
          }

          // ── Inject user headers ──────────────────────────────────────────
          request = new Request(request.url, {
            method: request.method,
            headers: new Headers([...request.headers.entries(),
              ['X-User-Id', String(user.userId)],
              ['X-User-Role', user.role],
              ['X-User-Name', user.displayName || user.username],
              ['X-User-Permissions', JSON.stringify(user.permissions)],
              ['X-User-Is-Admin', user.isAdministrator ? '1' : '0'],
            ]),
            body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : null,
          });
        }
      }

      // 6) API routes — dispatched via F2 router table (see API_ROUTES above export default).
      const apiResult = await dispatchApiRoute(request, env, url);
      if (apiResult) return apiResult;

      // 3) Static site passthrough (Pages assets binding)
      if (!env || !env.ASSETS || typeof env.ASSETS.fetch !== "function") {
        return new Response(
          "Worker error: env.ASSETS is missing.\n\n" +
            "This usually means the deployment is not providing the Pages assets binding.\n" +
            "Confirm _worker.js is at the deployment root next to index.html.\n",
          {
            status: 500,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          },
        );
      }

      return await env.ASSETS.fetch(request);
    } catch (err) {
      const msg =
        err && (err.stack || err.message)
          ? err.stack || err.message
          : String(err);

      return new Response("Worker crashed:\n\n" + msg, {
        status: 500,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
  },
};

// ════════════════════════════════════════════════════════════════════
// DATABASE SCHEMA REFERENCE
// Tables are created via SQL migrations run in Cloudflare D1 Console.
// This block is documentation only — not executable.
// ════════════════════════════════════════════════════════════════════
//
// TABLE: users — id, username, display_name, password, role, role_id, ...
// TABLE: sessions — id, user_id, expires_at, ...
// TABLE: roles — id, name, description, permissions (JSON), is_system, ...
// TABLE: parts — id, part_number, name, customer, density_material, L/W/H, weight, color, category, parent_group, ...
// TABLE: saved_combos — id, name, parts_json, ...
// TABLE: jobs — id, customer, status, po_number, invoice_number, line_items (JSON), ship_to_*, ...
// TABLE: job_line_items — id, job_id, part_number, description, quantity, dimensions, ...
// TABLE: bead_types, bead_stock, block_inventory, molding_log, block_consumption_log
// TABLE: shipments — id, direction, customer, origin, destination, status, ...
// TABLE: bol_customers — id, company, street, city, state, zip, ...
// TABLE: bol_carriers — id, name, scac, ...
// TABLE: bols — id, bol_number, date, customer_id, ship_to_*, carrier_*, commodity_description, ...
// TABLE: activity_log — id, timestamp, action, entity_type, entity_id, summary, detail, user_id, ...
// TABLE: saved_loads — id, name, job_id, customer, trailer_type, state_json, expires_at, ...
//
// See individual .sql migration files for full DDL.
// ════════════════════════════════════════════════════════════════════

// ========================
// Backend Logic Below
// ========================


// Reserved: will be used for per-endpoint write checks
function canWrite(request) {
  return ['admin', 'staff'].includes(request.headers.get('X-User-Role'));
}

// Reserved: will be used for admin-only endpoint checks
function isAdmin(request) {
  return request.headers.get('X-User-Role') === 'admin';
}

async function handleApiAdminR2Backfill(request, env) {
  if (request.headers.get('X-User-Is-Admin') !== '1') {
    return json({ ok: false, error: 'Administrator access required.' }, 403);
  }

  const db = env.DB;
  const url = new URL(request.url);
  const type = url.searchParams.get('type') || '';
  const batchSize = Math.min(parseInt(url.searchParams.get('batch') || '50', 10), 100);

  if (type === 'loading-photos') {
    try {
      const { results } = await db.prepare(`
        SELECT id, assignment_id, photo_data FROM loading_photos
        WHERE photo_key IS NULL AND LENGTH(photo_data) > 10
        LIMIT ?
      `).bind(batchSize).all();

      const rows = results || [];
      let migrated = 0;
      for (const row of rows) {
        try {
          const isPng = row.photo_data.startsWith('iVBOR');
          const ext = isPng ? 'png' : 'jpg';
          const contentType = isPng ? 'image/png' : 'image/jpeg';
          const r2Key = `loading-photos/${row.assignment_id}/${row.id}.${ext}`;
          const bytes = Uint8Array.from(atob(row.photo_data), c => c.charCodeAt(0));
          await env.BOL_PHOTOS.put(r2Key, bytes, { httpMetadata: { contentType } });
          // Only clear D1 blob after confirmed R2 put
          await db.prepare(
            "UPDATE loading_photos SET photo_key = ?, photo_data = '' WHERE id = ?"
          ).bind(r2Key, row.id).run();
          migrated++;
        } catch (e) {
          console.error('Backfill failed for loading_photo', row.id, e);
        }
      }

      const { remaining } = await db.prepare(`
        SELECT COUNT(*) AS remaining FROM loading_photos
        WHERE photo_key IS NULL AND LENGTH(photo_data) > 10
      `).first();

      await logActivity(db, 'update', 'r2_backfill', 'loading-photos',
        `R2 backfill: migrated ${migrated} loading photos`,
        { migrated, remaining });

      return json({ ok: true, type, migrated, remaining });
    } catch (e) {
      return json({ ok: false, error: 'Server error.', detail: String(e?.message || e) }, 500);
    }
  }

  if (type === 'packing-slips') {
    try {
      const { results } = await db.prepare(`
        SELECT id, packing_slip_pdf FROM jobs
        WHERE packing_slip_key IS NULL AND packing_slip_pdf IS NOT NULL AND packing_slip_pdf != ''
        LIMIT ?
      `).bind(batchSize).all();

      const rows = results || [];
      let migrated = 0;
      for (const row of rows) {
        try {
          const r2Key = `packing-slips/${row.id}.pdf`;
          const bytes = Uint8Array.from(atob(row.packing_slip_pdf), c => c.charCodeAt(0));
          await env.BOL_PHOTOS.put(r2Key, bytes, { httpMetadata: { contentType: 'application/pdf' } });
          // Only clear D1 blob after confirmed R2 put
          await db.prepare(
            "UPDATE jobs SET packing_slip_key = ?, packing_slip_pdf = NULL WHERE id = ?"
          ).bind(r2Key, row.id).run();
          migrated++;
        } catch (e) {
          console.error('Backfill failed for packing slip job', row.id, e);
        }
      }

      const remaining_row = await db.prepare(`
        SELECT COUNT(*) AS remaining FROM jobs
        WHERE packing_slip_key IS NULL AND packing_slip_pdf IS NOT NULL AND packing_slip_pdf != ''
      `).first();
      const remaining = remaining_row?.remaining ?? 0;

      await logActivity(db, 'update', 'r2_backfill', 'packing-slips',
        `R2 backfill: migrated ${migrated} packing slips`,
        { migrated, remaining });

      return json({ ok: true, type, migrated, remaining });
    } catch (e) {
      return json({ ok: false, error: 'Server error.', detail: String(e?.message || e) }, 500);
    }
  }

  return json({ ok: false, error: 'type must be loading-photos or packing-slips' }, 400);
}

// ========================
// Notifications API
// ========================

