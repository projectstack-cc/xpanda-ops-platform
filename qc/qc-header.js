const isDashboard = window.location.pathname === "/qc/" ||
                    window.location.pathname === "/qc/index.html";

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