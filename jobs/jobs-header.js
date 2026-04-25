const path = window.location.pathname;

const isDashboard =
  path === "/jobs/" ||
  path === "/jobs/index.html";

document.write(`

<header class="topbar">

    ${!isDashboard ? `
        <a href="/jobs/" class="jobs-back-link">← Back to Job Board</a>
    ` : ``}

    <a href="/" aria-label="Back to Operations Platform">
        <img src="/logo/xpanda.png" alt="xPanda Logo" class="logo">
    </a>

    <div class="header-center">

        <a href="/jobs/" class="badge jobs-badge" title="Back to Job Board">
            XPANDA FOAM • JOBS
        </a>

        <h1 id="jobs-page-title">Job Board</h1>
        <p id="jobs-page-subtitle">Production job tracking and shipping schedule</p>

    </div>

</header>

`);

window.addEventListener("DOMContentLoaded", () => {

  const footer = document.createElement("footer");
  footer.className = "jobs-platform-footer";
  footer.innerHTML = `<a href="/">← Back to Operations Platform</a>`;
  document.body.appendChild(footer);

});
