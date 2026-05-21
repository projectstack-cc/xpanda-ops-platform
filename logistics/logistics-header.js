const path = window.location.pathname;

const isDashboard =
  path === "/logistics/" ||
  path === "/logistics/index.html";

// NOTE: document.write() is used here for legacy compatibility.
// Future refactor: switch to DOMContentLoaded + insertAdjacentHTML.
document.write(`

<header class="topbar">

    ${!isDashboard ? `
        <a href="/logistics/" class="logistics-back-link">← Back to Logistics</a>
    ` : ``}

    <a href="/" aria-label="Back to Operations Platform">
        <img src="/logo/xpanda.png" alt="xPanda Logo" class="logo">
    </a>

    <div class="header-center">

        <a href="/logistics/" class="badge logistics-badge" title="Back to Logistics">
            XPANDA FOAM • LOGISTICS
        </a>

        <h1 id="logistics-page-title">Logistics</h1>
        <p id="logistics-page-subtitle">Inbound deliveries and outbound shipments</p>

    </div>

    <div class="header-user-bar" style="position:absolute;top:10px;right:16px;font-size:12px;color:#5b6472;display:flex;align-items:center;gap:8px;">
      <span id="hdr-user-name"></span>
      <a href="#" id="hdr-logout" style="color:#dc2626;text-decoration:none;font-weight:600;">Sign Out</a>
    </div>

</header>

`);

window.addEventListener("DOMContentLoaded", () => {

  const footer = document.createElement("footer");
  footer.className = "logistics-platform-footer";
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
    window.__xpandaUser = d.ok ? d.user : null;
    if (d.ok && d.user) {
      const el = document.getElementById('hdr-user-name');
      if (el) el.textContent = d.user.displayName || d.user.username;
    }
  }).catch(() => { window.__xpandaUser = null; });

  document.getElementById('hdr-logout')?.addEventListener('click', async (e) => {
    e.preventDefault();
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login.html';
  });

});
