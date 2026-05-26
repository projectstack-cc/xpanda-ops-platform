const path = window.location.pathname;

const isDashboard =
  path === "/qc/" ||
  path === "/qc/index.html";

document.write(`

<header class="topbar">

    ${!isDashboard ? `
        <a href="/qc/" class="qc-back-link">← Back to Dashboard</a>
    ` : ``}

    <a href="/" aria-label="Back to Operations Platform">
        <img src="/logo/xpanda.png" alt="xPanda Logo" class="logo">
    </a>

    <div class="header-center">

        <a href="/qc/" class="badge qc-badge" title="Back to QC Dashboard">
            XPANDA FOAM • QUALITY CONTROL
        </a>

        <h1 id="qc-page-title">QC Dashboard</h1>
        <p id="qc-page-subtitle">Select a quality workflow to begin</p>

    </div>

    <div class="header-user-bar" style="position:absolute;top:10px;right:16px;font-size:12px;color:#5b6472;display:flex;align-items:center;gap:8px;">
      <span id="hdr-user-name"></span>
      <a href="#" id="hdr-logout" style="color:#dc2626;text-decoration:none;font-weight:600;">Sign Out</a>
    </div>

</header>

`);

window.addEventListener("DOMContentLoaded", () => {

  const footer = document.createElement("footer");
  footer.className = "qc-platform-footer";
  footer.innerHTML = `<a href="/">← Back to Operations Platform</a>`;
  document.body.appendChild(footer);

  // 401 handler
  const _origFetch = window.fetch;
  window.fetch = async function(...args) {
    const res = await _origFetch.apply(this, args);
    if (res.status === 401 && !window.location.pathname.startsWith('/login')) {
      window.location.href = '/login.html';
      return res;
    }
    return res;
  };

  fetch('/api/auth/me').then(r => r.json()).then(d => {
    if (d.ok && d.user) {
      const el = document.getElementById('hdr-user-name');
      if (el) el.textContent = d.user.displayName || d.user.username;
      if (d.user.simulatingRole) {
        const simBanner = document.createElement('div');
        simBanner.id = 'sim-role-banner';
        simBanner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:10000;background:#f59e0b;color:#000;padding:6px 16px;display:flex;align-items:center;justify-content:center;gap:12px;font-size:14px;font-weight:600;box-shadow:0 2px 4px rgba(0,0,0,0.2);';
        simBanner.innerHTML = `<span>🔍 Testing as: ${d.user.simulatingRole.name}</span><button id="sim-stop-btn" style="background:#fff;color:#000;border:1px solid #000;border-radius:4px;padding:4px 12px;cursor:pointer;font-size:13px;font-weight:600;">Stop Testing</button>`;
        document.body.prepend(simBanner);
        document.body.style.paddingTop = simBanner.offsetHeight + 'px';
        document.getElementById('sim-stop-btn').addEventListener('click', async () => {
          try {
            const res = await fetch('/api/auth/simulate-role', { method: 'DELETE' });
            const data = await res.json();
            if (data.ok) { window.location.reload(); } else { alert('Failed to stop simulation: ' + (data.error || 'Unknown error')); }
          } catch (e) { alert('Error stopping simulation: ' + e.message); }
        });
      }
    }
  }).catch(() => {});

  document.getElementById('hdr-logout')?.addEventListener('click', async (e) => {
    e.preventDefault();
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login.html';
  });

});
