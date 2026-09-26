/* GeoOS desktop — GeoBrowse (web browser + search) app and shared helpers.
   Part of the split web UI; index.html loads app.js first, then the
   apps-*.js files, then demo.js. All files share one global scope. */

/* ============================ shared helpers ============================ */
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ============================ geobrowse app (browser + search) ============================ */
function mountGeoBrowse(body, win, opts) {
  body.innerHTML =
    `<div class="gs-wrap"><div class="gs-toolbar">` +
    `<button data-a="back" title="Back">&#8592;</button>` +
    `<button data-a="fwd" title="Forward">&#8594;</button>` +
    `<button data-a="reload" title="Reload">&#x21bb;</button>` +
    `<button data-a="home" title="Home">&#8962;</button>` +
    `<input class="gs-addr" placeholder="Search the web or type a URL" ` +
    `autocapitalize="none" autocomplete="off" autocorrect="off" spellcheck="false">` +
    `<button class="btn-primary" data-a="go">Go</button>` +
    `<button data-a="pop" title="Open in your real browser">&#8599;</button>` +
    `</div><div class="gs-view"></div><div class="gs-status">ready</div></div>`;
  const view = body.querySelector(".gs-view");
  const addr = body.querySelector(".gs-addr");
  const status = body.querySelector(".gs-status");
  const hist = []; let hi = -1;
  let currentUrl = null;

  const looksLikeUrl = (s) => /^https?:\/\//i.test(s) ||
    (!/\s/.test(s) && /^[\w-]+(\.[\w-]+)+(:\d+)?(\/|$)/.test(s));
  const setStatus = (t) => { status.textContent = t; };

  function homeView() {
    view.innerHTML =
      `<div class="gs-home"><div class="gs-logo">Geo<span>Browse</span></div>` +
      `<div class="gs-tag">the live web, from inside GeoOS</div>` +
      `<div class="gs-hints">` + (DEMO
        ? "demo preview: browsing is live for embeddable sites, search uses DuckDuckGo's instant answers — deploy locally for the full proxied web"
        : "type a search or a URL above — pages render here live through the sandboxed proxy, links keep working in-window") +
      `</div></div>`;
    addr.value = "";
    currentUrl = null;
    setStatus("home");
  }

  function navigate(input, push = true) {
    input = (input || "").trim();
    if (!input) return;
    addr.value = input;
    if (looksLikeUrl(input)) loadPage(input, push);
    else doSearch(input, push);
  }

  function pushHist(t, v, push) {
    if (!push) return;
    if (hist[hi] && hist[hi].t === t && hist[hi].v === v) return;
    hist.splice(hi + 1);
    hist.push({ t, v });
    hi++;
  }

  async function doSearch(qtext, push = true) {
    setStatus("searching: " + qtext + " ...");
    if (DEMO) {
      // no server here — but DuckDuckGo's instant-answer API allows CORS,
      // so the preview can still return real live answers
      view.innerHTML = `<div class="gs-loading">asking duckduckgo for “${escapeHtml(qtext)}” ...</div>`;
      try {
        const ac = new AbortController();
        const to = setTimeout(() => ac.abort(), 8000);
        const r = await fetch("https://api.duckduckgo.com/?format=json&no_html=1&no_redirect=1&q=" +
          encodeURIComponent(qtext), { signal: ac.signal });
        clearTimeout(to);
        const j = await r.json();
        const topics = [];
        if (j.AbstractText && j.AbstractURL)
          topics.push({ title: j.Heading || qtext, url: j.AbstractURL, snippet: j.AbstractText });
        for (const t of (j.RelatedTopics || [])) {
          if (t.Text && t.FirstURL) topics.push({ title: t.Text.split(" - ")[0], url: t.FirstURL, snippet: t.Text });
          if (topics.length >= 10) break;
        }
        if (!topics.length) throw new Error("no instant answers");
        view.innerHTML = `<div class="gs-results"><h3>Live answers for “${escapeHtml(qtext)}”</h3>` +
          topics.map(r =>
            `<div class="gs-result"><a href="${escapeHtml(r.url)}" data-url="${escapeHtml(r.url)}">${escapeHtml(r.title)}</a>` +
            `<div class="gs-url">${escapeHtml(r.url)}</div>` +
            `<div class="gs-snippet">${escapeHtml(r.snippet)}</div></div>`).join("") +
          `<div class="gs-hint">instant answers via duckduckgo · deploy locally for full web results</div></div>`;
        view.querySelectorAll("a[data-url]").forEach(a =>
          a.onclick = (e) => { e.preventDefault(); loadPage(a.dataset.url); });
        setStatus(topics.length + " live answers (demo)");
      } catch (e) {
        const url = "https://duckduckgo.com/?q=" + encodeURIComponent(qtext);
        view.innerHTML =
          `<div class="gs-note"><h3>Search: “${escapeHtml(qtext)}”</h3>` +
          `<p><a class="gs-open" href="${url}" target="_blank" rel="noopener">` +
          `Open “${escapeHtml(qtext)}” in your real browser &#8599;</a></p>` +
          `<p class="gs-hint">Run <code>pip install geov-os &amp;&amp; geov deploy</code> — ` +
          `GeoBrowse then does full in-window search + browsing via the sandboxed proxy.</p></div>`;
        setStatus("demo mode");
      }
      pushHist("search", qtext, push);
      return;
    }
    view.innerHTML = `<div class="gs-loading">searching the web for “${escapeHtml(qtext)}” ...</div>`;
    try {
      const j = await apiGet("/api/search?q=" + encodeURIComponent(qtext));
      if (j.error) throw new Error(j.error);
      if (!j.results || !j.results.length) {
        view.innerHTML = `<div class="gs-note"><h3>No results for “${escapeHtml(qtext)}”</h3></div>`;
        setStatus("0 results");
        pushHist("search", qtext, push);
        return;
      }
      view.innerHTML = `<div class="gs-results"><h3>Results for “${escapeHtml(qtext)}”</h3>` +
        j.results.map(r =>
          `<div class="gs-result"><a href="${escapeHtml(r.url)}" data-url="${escapeHtml(r.url)}">${escapeHtml(r.title)}</a>` +
          `<div class="gs-url">${escapeHtml(r.url)}</div>` +
          `<div class="gs-snippet">${escapeHtml(r.snippet)}</div></div>`).join("") +
        `</div>`;
      view.querySelectorAll("a[data-url]").forEach(a =>
        a.onclick = (e) => { e.preventDefault(); loadPage(a.dataset.url); });
      setStatus(j.results.length + " results");
      pushHist("search", qtext, push);
    } catch (e) {
      view.innerHTML = `<div class="gs-note"><h3>Search failed</h3><p>${escapeHtml(e.message)}</p></div>`;
      setStatus("error");
    }
  }

  // when a page inside the (same-origin) iframe navigates — the proxy
  // rewrites links to stay in-window — sync the address bar + history
  function watchFrame(fr, push) {
    fr.onload = () => {
      let actual = null;
      try {
        const loc = fr.contentWindow.location;
        if (loc && loc.pathname === "/browse")
          actual = new URLSearchParams(loc.search).get("url");
      } catch (e) { /* frame went cross-origin (external redirect chain) */ }
      if (actual) {
        currentUrl = actual;
        addr.value = actual;
        setStatus(actual);
        pushHist("page", actual, push);
      } else if (currentUrl) {
        setStatus(currentUrl + "  (left the proxy — use ↗ if blank)");
      }
    };
    fr.onerror = () => setStatus("failed to load " + (currentUrl || ""));
  }

  function loadPage(url, push = true) {
    if (!/^https?:\/\//i.test(url)) url = "https://" + url;
    addr.value = url;
    currentUrl = url;
    if (DEMO) {
      // live attempt: sites that allow framing render right here
      view.innerHTML =
        `<iframe class="gs-frame" src="${escapeHtml(url)}" ` +
        `sandbox="allow-scripts allow-same-origin allow-forms allow-popups"></iframe>`;
      setStatus("loading " + url + " (live, direct) — some sites block embedding; use ↗ if it stays blank");
      const fr = view.querySelector("iframe");
      fr.onload = () => setStatus(url + "  (live, direct)");
      fr.onerror = () => setStatus("failed to load " + url + " — try the ↗ pop-out");
    } else {
      view.innerHTML =
        `<iframe class="gs-frame" src="/browse?url=${encodeURIComponent(url)}" ` +
        `sandbox="allow-scripts allow-same-origin allow-forms allow-popups"></iframe>`;
      setStatus("loading " + url + " ...");
      watchFrame(view.querySelector("iframe"), push);
    }
    pushHist("page", url, push);
  }

  const replay = (e) => {
    addr.value = e.v;
    e.t === "page" ? loadPage(e.v, false) : doSearch(e.v, false);
  };
  body.querySelector('[data-a="back"]').onclick = () => { if (hi > 0) { hi--; replay(hist[hi]); } };
  body.querySelector('[data-a="fwd"]').onclick = () => { if (hi < hist.length - 1) { hi++; replay(hist[hi]); } };
  body.querySelector('[data-a="reload"]').onclick = () => { if (hist[hi]) replay(hist[hi]); else homeView(); };
  body.querySelector('[data-a="home"]').onclick = homeView;
  body.querySelector('[data-a="pop"]').onclick = () => {
    const v = addr.value.trim();
    if (!v) return;
    window.open(looksLikeUrl(v)
      ? (/^https?:/i.test(v) ? v : "https://" + v)
      : "https://duckduckgo.com/?q=" + encodeURIComponent(v), "_blank");
  };
  body.querySelector('[data-a="go"]').onclick = () => navigate(addr.value);
  addr.addEventListener("keydown", (e) => { if (e.key === "Enter") navigate(addr.value); });

  homeView();
  if (opts && opts.query) navigate(opts.query);
}

function hexDump(hex) {
  const lines = [];
  for (let off = 0; off < Math.min(hex.length, 1024); off += 32) {
    const chunk = hex.slice(off, off + 32);
    const bytes = chunk.match(/../g) || [];
    const hexs = bytes.join(" ");
    const text = bytes.map(h => {
      const c = parseInt(h, 16);
      return c >= 32 && c < 127 ? String.fromCharCode(c) : ".";
    }).join("");
    lines.push((off / 2).toString(16).padStart(8, "0") + "  " +
      hexs.padEnd(48) + "  |" + text + "|");
  }
  if (hex.length > 1024) lines.push(`... (${hex.length / 2 - 512} more bytes)`);
  return lines.join("\n");
}
