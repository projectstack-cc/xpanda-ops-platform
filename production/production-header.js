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

</header>

`);

window.addEventListener("DOMContentLoaded", () => {

  const footer = document.createElement("footer");
  footer.className = "prod-platform-footer";
  footer.innerHTML = `<a href="/">← Back to Operations Platform</a>`;
  document.body.appendChild(footer);

});
