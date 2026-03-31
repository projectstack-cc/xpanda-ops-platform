(function(){

const header = document.createElement("div");
header.className = "topbar";

header.innerHTML = `
<a href="/" aria-label="Back to Operations Platform">
<img class="logo" src="/logo/xpanda.png">
</a>

<div class="header-center">

<a class="badge reports-badge" href="/reports/" title="Back to Reports Dashboard">
XPANDA FOAM • REPORTS
</a>

<h1 id="reports-page-title"></h1>

<p>Select a reporting workflow to begin</p>

</div>
`;

document.body.prepend(header);

})();
