(function(){

const header = document.createElement("div");
header.className = "topbar";
header.style.position = "relative";

header.innerHTML = `
<a href="/" aria-label="Back to Operations Platform">
<img class="logo" src="/logo/xpanda.png" alt="xPanda Logo">
</a>

<div class="header-center">

<a class="badge reports-badge" href="/reports/" title="Back to Reports Dashboard">
XPANDA FOAM • REPORTS
</a>

<h1 id="reports-page-title"></h1>

<p>Select a reporting workflow to begin</p>

</div>

<div style="position:absolute;top:10px;right:16px;font-size:12px;color:#5b6472;display:flex;align-items:center;gap:8px;">
  <span id="hdr-user-name"></span>
  <a href="#" id="hdr-logout" style="color:#dc2626;text-decoration:none;font-weight:600;">Sign Out</a>
</div>
`;

document.body.prepend(header);

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

})();
