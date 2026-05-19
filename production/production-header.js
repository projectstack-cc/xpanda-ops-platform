const path = window.location.pathname;

const isDashboard =
  path === "/production/" ||
  path === "/production/index.html";

document.write(`

<header class="topbar">

    ${!isDashboard ? `
        <a href="/production/" class="prod-back-link">← Back to Dashboard</a>
    ` : ``}

    <a href="/" aria-label="Back to Operations Platform">
        <img src="/logo/xpanda.png" alt="xPanda Logo" class="logo">
    </a>

    <div class="header-center">

        <a href="/production/" class="badge prod-badge" title="Back to Production Dashboard">
            XPANDA FOAM • PRODUCTION
        </a>

        <h1 id="prod-page-title">Production Dashboard</h1>
        <p id="prod-page-subtitle">Production planning and manufacturing tools</p>

    </div>

    <div class="header-user-bar" style="position:absolute;top:10px;right:16px;font-size:12px;color:#5b6472;display:flex;align-items:center;gap:8px;">
      <span id="hdr-user-name"></span>
      <a href="#" id="hdr-logout" style="color:#dc2626;text-decoration:none;font-weight:600;">Sign Out</a>
    </div>

</header>

`);

window.addEventListener("DOMContentLoaded", () => {

  const footer = document.createElement("footer");
  footer.className = "prod-platform-footer";
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
    }
  }).catch(() => {});

  document.getElementById('hdr-logout')?.addEventListener('click', async (e) => {
    e.preventDefault();
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login.html';
  });

});
