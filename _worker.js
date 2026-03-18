// _worker.js — Pages Advanced Mode with SAFE error reporting

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 🔥 Training redirect safety net
    if (url.pathname === "/training" || url.pathname === "/training/") {
      return Response.redirect(`${url.origin}/safety/training/`, 301);
    }

    // existing logic continues below...

      // 1) Health check
      if (url.pathname === "/health") {
        return new Response("FUNCTIONS_OK", { status: 200 });
      }

      // 2) API route
      if (url.pathname === "/api/completions") {
        return handleApiCompletions(request, env);
      }

      // 3) Static site passthrough (Pages assets binding)
      if (!env || !env.ASSETS || typeof env.ASSETS.fetch !== "function") {
        // This is the BIG smoking gun if it triggers.
        return new Response(
          "Worker error: env.ASSETS is missing.\n\n" +
          "This usually means the deployment is not providing the Pages assets binding.\n" +
          "Confirm _worker.js is at the deployment root next to index.html.\n",
          { status: 500, headers: { "Content-Type": "text/plain; charset=utf-8" } }
        );
      }

      return await env.ASSETS.fetch(request);

    } catch (err) {
      // Prevent Cloudflare 1019 by always returning a response
      const msg = (err && (err.stack || err.message)) ? (err.stack || err.message) : String(err);
      return new Response(
        "Worker crashed:\n\n" + msg,
        { status: 500, headers: { "Content-Type": "text/plain; charset=utf-8" } }
      );
    }
  },
};


// ========================
// Backend Logic Below
// ========================

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
  });
}

function isAdminAuthorized(request, env) {
  const key = env.ADMIN_KEY;
  if (!key) return false;

  const auth = request.headers.get("Authorization") || "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) return false;

  return match[1] === key;
}

function normalizeName(s) {
  return String(s || "").trim().replace(/\s+/g, " ");
}

async function hashIp(ip) {
  if (!ip) return null;
  try {
    const data = new TextEncoder().encode(ip);
    const digest = await crypto.subtle.digest("SHA-256", data);
    return [...new Uint8Array(digest)]
      .map(b => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return null;
  }
}

async function handleApiCompletions(request, env) {
  const db = env.DB;
  if (!db) return json({ ok: false, error: "Missing D1 binding: DB" }, 500);

  const url = new URL(request.url);

  // POST (employee submit)
  if (request.method === "POST") {
    let payload;
    try {
      payload = await request.json();
    } catch {
      return json({ ok: false, error: "Invalid JSON" }, 400);
    }

    const employee_name = normalizeName(payload.employee_name);
    const block_id = String(payload.block_id || "").trim();
    const block_title = String(payload.block_title || "").trim();
    const attested = payload.attested === true;

    if (!employee_name) return json({ ok: false, error: "Name required." }, 400);
    if (!block_id) return json({ ok: false, error: "block_id required." }, 400);
    if (!block_title) return json({ ok: false, error: "block_title required." }, 400);
    if (!attested) return json({ ok: false, error: "Attestation required." }, 400);

    const ip = request.headers.get("CF-Connecting-IP");
    const ip_hash = await hashIp(ip);
    const user_agent = request.headers.get("User-Agent") || null;

    try {
      await db.prepare(`
        INSERT INTO completions
        (employee_name, block_id, block_title, attested, ip_hash, user_agent)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      .bind(employee_name, block_id, block_title, 1, ip_hash, user_agent)
      .run();

      return json({ ok: true, message: "Completion recorded." }, 201);

    } catch (e) {
      const msg = String(e?.message || e);

      if (/constraint/i.test(msg) || /unique/i.test(msg)) {
        return json(
          { ok: false, error: "Already submitted today.", code: "DUPLICATE_TODAY" },
          409
        );
      }

      return json({ ok: false, error: "Server error.", detail: msg }, 500);
    }
  }

  // GET (admin)
  if (request.method === "GET") {
    if (!isAdminAuthorized(request, env)) {
      return json({ ok: false, error: "Unauthorized" }, 401);
    }

    const params = url.searchParams;
    const limit = Math.min(Math.max(parseInt(params.get("limit") || "200", 10), 1), 2000);
    const offset = Math.max(parseInt(params.get("offset") || "0", 10), 0);

    const results = await db.prepare(`
      SELECT id, employee_name, block_id, block_title,
             attested, submitted_at, submitted_date
      FROM completions
      ORDER BY submitted_at DESC
      LIMIT ? OFFSET ?
    `).bind(limit, offset).all();

    return json({ ok: true, rows: results.results || [], limit, offset });
  }

  return json({ ok: false, error: "Method Not Allowed" }, 405);
}