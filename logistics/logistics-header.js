const path = window.location.pathname;

const isDashboard =
  path === "/logistics/" ||
  path === "/logistics/index.html";

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

</header>

`);

window.addEventListener("DOMContentLoaded", () => {

  const footer = document.createElement("footer");
  footer.className = "logistics-platform-footer";
  footer.innerHTML = `<a href="/">← Back to Operations Platform</a>`;
  document.body.appendChild(footer);

});
