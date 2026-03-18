const path = window.location.pathname;

const isDashboard =
  path === "/qc/" ||
  path === "/qc/index.html";

document.write(`
<header class="topbar">

    ${!isDashboard ? `
        <a href="/qc/" class="qc-back-link">← Back to Dashboard</a>
    ` : ``}

    <img src="/logo/xpanda.png" alt="xPanda Logo" class="logo">

    <div class="header-center">
        <div class="badge">xPanda Foam • Quality Control</div>
        <h1 id="qc-page-title">QC Dashboard</h1>
        <p id="qc-page-subtitle">Select a quality workflow to begin</p>
    </div>

</header>
`);

if (!isDashboard) {
  window.addEventListener("DOMContentLoaded", () => {
    const footer = document.createElement("footer");
    footer.className = "qc-platform-footer";
    footer.innerHTML = `<a href="/">← Back to Operations Platform</a>`;
    document.body.appendChild(footer);
  });
}