// ─────────────────────────────────────────────────────────────────────────
// Chains dashboard — Relationships (3D graph), Networks (chains + RPC + L2
// scaling), and Incidents (live operator status, last 30 days).
// Data: live chains-api (/export bulk + per-chain endpoints) and
// chains-status-news (WebSocket /ws). Forum data is excluded for now.
// ─────────────────────────────────────────────────────────────────────────

const SAME_ORIGIN_API =
    location.port === '3000' || location.hostname === 'chains-api.johnaverse.cc';
const API_BASE = SAME_ORIGIN_API ? '' : 'https://chains-api.johnaverse.cc';
const STATUS_NEWS_BASE = 'https://chains-status-news.johnaverse.cc';

const COLORS = {
    Mainnet: '#10b981', L2: '#8b5cf6', Testnet: '#f59e0b', Beacon: '#ec4899', Default: '#6b7280'
};
const ALL_SOURCES = ['chains', 'chainlist', 'theGraph', 'slip44', 'l2beat'];

const state = {
    chains: [], byId: new Map(), rel: new Map(),
    l2beat: new Map(), l2beatProjects: [], l2beatMeta: null,
    statusPagesByChain: new Map(),
    lastUpdated: null
};

// graph state
let graphData = { nodes: [], links: [] };
let filteredData = { nodes: [], links: [] };
let currentFilter = 'all';
let enabledSources = new Set(ALL_SOURCES);
let myGraph = null;
let graphBuilt = false;

// ─── DOM helper ───
function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
        else if (v !== null && v !== undefined) node.setAttribute(k, v);
    }
    for (const c of [].concat(children)) {
        if (c == null) continue;
        node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return node;
}

function classify(c) {
    if (c.tags?.includes('Beacon')) return 'Beacon';
    if (c.tags?.includes('L2')) return 'L2';
    if (c.tags?.includes('Testnet')) return 'Testnet';
    return 'Mainnet';
}
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
function fmtUsd(n) {
    if (n == null || !Number.isFinite(n)) return '—';
    if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
    if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
    if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
    return `$${n.toFixed(0)}`;
}
function fmtDuration(ms) {
    if (!ms || ms < 0) return null;
    const m = Math.round(ms / 60000);
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ${m % 60}m`;
    return `${Math.floor(h / 24)}d ${h % 24}h`;
}
function safeHost(url) { try { const u = new URL(url); return (u.protocol === 'http:' || u.protocol === 'https:') ? u.host : null; } catch { return null; } }
function iconColorFor(chainId) { const c = state.byId.get(chainId); return c ? COLORS[classify(c)] : COLORS.Default; }
function networkIcon(label, color, cls = 'net-icon') {
    const n = el('span', { class: cls, text: (label || '?').charAt(0).toUpperCase() });
    n.style.background = `linear-gradient(135deg, ${color}, ${color}44)`;
    return n;
}

async function api(path, { timeoutMs = 25000 } = {}) {
    // fetch() has no built-in timeout — a stalled response (e.g. the multi-MB
    // /export over a flaky connection) would otherwise hang forever and the
    // page would never fall back or surface an error. Abort so callers can.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const res = await fetch(`${API_BASE}${path}`, { headers: { accept: 'application/json' }, signal: ctrl.signal });
        if (!res.ok) throw new Error(`${path} → ${res.status}`);
        return await res.json();
    } finally {
        clearTimeout(timer);
    }
}

// ─────────────────────────────── bootstrap ───────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    initTabs();
    initSearch();
    initGraphControls();
    initDrawer();
    initIncidentControls();
    initChainsTableHeader();
    initAppbarHeight();     // keep --appbar-h in sync with the real bar height
    applyUrlState();        // restore view + ?q= immediately (before data loads)
    // Start the live incidents feed immediately — it must NOT wait on the heavy
    // /export bulk load (13MB + 3D graph build) or it appears stuck.
    connectStatusFeed();
    loadStatsLine();
    loadBulk();
    window.addEventListener('popstate', applyUrlState);
});

let stats = null;
async function loadStatsLine() {
    try {
        stats = await api('/stats');
        document.getElementById('statsLine').textContent =
            `${stats.totalChains} chains · ${stats.totalMainnets} mainnets · ${stats.totalL2s} L2s · ${stats.totalTestnets} testnets`;
        renderSummaryCards();
    } catch { /* noop */ }
}

async function loadBulk() {
    let payload;
    // Try the live export, retry once (transient tunnel blips happen), then
    // fall back to the checked-in snapshot so the dashboard still renders.
    for (let attempt = 0; attempt < 2 && !payload; attempt++) {
        try { payload = await api('/export'); }
        catch { if (attempt === 0) await new Promise(r => setTimeout(r, 1200)); }
    }
    if (!payload) {
        try { payload = await (await fetch('export.json')).json(); }
        catch { return graphLoadError(); }
    }
    const data = payload.data ?? payload;
    state.chains = data.indexed?.all ?? [];
    state.lastUpdated = data.lastUpdated ?? null;
    state.byId = new Map(state.chains.map(c => [c.chainId, c]));
    state.l2beatMeta = data.l2beat ? { source: data.l2beat.source, count: (data.l2beat.projects || []).length } : null;
    state.l2beatProjects = data.l2beat?.projects ?? [];
    for (const p of state.l2beatProjects) if (p.chainId != null) state.l2beat.set(p.chainId, p);

    buildRelations();
    buildGraph();
    renderSummaryCards();   // total TVS needs the L2BEAT projects just loaded
    renderScalingChart();
    renderChainsView();
    if (!document.getElementById('statsLine').textContent.includes('chains')) {
        document.getElementById('statsLine').textContent = `${state.chains.length} chains loaded`;
    }
    loadStatusPages();      // populate drawer status-page links (no list UI)
    applyUrlState();        // deep-link ?chain=
}

function graphLoadError() {
    const o = document.getElementById('loadingOverlay');
    if (!o) return;
    o.querySelector('.spinner').style.display = 'none';
    o.querySelector('p').textContent = 'Failed to load data.';
    o.querySelector('.loading-sub').textContent = 'Check your connection or that the API is reachable.';
}

// ─── relations ───
function relEntry(id) {
    if (!state.rel.has(id)) state.rel.set(id, { l1Parent: null, mainnet: null, l2Children: [], testnetChildren: [] });
    return state.rel.get(id);
}
function buildRelations() {
    for (const c of state.chains) {
        for (const r of c.relations ?? []) {
            if (r.chainId == null) continue;
            if (r.kind === 'l2Of') { relEntry(c.chainId).l1Parent = r.chainId; relEntry(r.chainId).l2Children.push(c.chainId); }
            else if (r.kind === 'parentOf') { relEntry(r.chainId).l1Parent = c.chainId; relEntry(c.chainId).l2Children.push(r.chainId); }
            else if (r.kind === 'testnetOf') { relEntry(c.chainId).mainnet = r.chainId; relEntry(r.chainId).testnetChildren.push(c.chainId); }
            else if (r.kind === 'mainnetOf') { relEntry(r.chainId).mainnet = c.chainId; relEntry(c.chainId).testnetChildren.push(r.chainId); }
        }
    }
    for (const e of state.rel.values()) { e.l2Children = [...new Set(e.l2Children)]; e.testnetChildren = [...new Set(e.testnetChildren)]; }
}

// ─── keep --appbar-h equal to the real (wrapping) app-bar height ───
// The bar is position:fixed; content uses padding-top:var(--appbar-h). A fixed
// guess overlaps on mobile when the bar wraps to extra rows (long stats line,
// scrolled tabs). Measuring it guarantees content always clears the bar.
function initAppbarHeight() {
    const bar = document.getElementById('appbar');
    if (!bar) return;
    const sync = () => document.documentElement.style.setProperty('--appbar-h', `${bar.offsetHeight}px`);
    sync();
    window.addEventListener('resize', sync);
    if ('ResizeObserver' in window) new ResizeObserver(sync).observe(bar);
}

// ─────────────────────────────── tabs ───────────────────────────────
function initTabs() {
    document.querySelectorAll('#tabs .tab').forEach(btn => btn.addEventListener('click', () => switchView(btn.dataset.view)));
}
// View / search / selected-chain are all reflected in the URL so each tab is a
// separate, shareable, reloadable page (e.g. ?view=incidents&q=base).
const VIEWS = ['graph', 'networks', 'incidents', 'providers'];
let activeView = 'graph';
let searchQuery = '';
let openChainId = null;

function switchView(view, opts = {}) {
    if (!VIEWS.includes(view)) view = 'graph';
    activeView = view;
    document.querySelectorAll('#tabs .tab').forEach(b => b.classList.toggle('active', b.dataset.view === view));
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById(`view-${view}`).classList.add('active');
    document.body.classList.toggle('graph-active', view === 'graph');
    if (view === 'graph' && myGraph) setTimeout(() => myGraph.width(window.innerWidth).height(window.innerHeight), 0);
    updateSearchPlaceholder();
    applySearch();
    if (!opts.fromUrl) updateUrl({ push: true });
}

function updateSearchPlaceholder() {
    const input = document.getElementById('searchInput');
    if (input) input.placeholder = activeView === 'networks' ? 'Filter networks — id or name…'
        : activeView === 'incidents' ? 'Filter incidents — network or title…'
        : activeView === 'providers' ? 'Filter provider incidents — provider, chain or title…'
        : 'Find a network — id or name…';
}

// Apply the current ?q= search to whichever page is active.
function applySearch() {
    if (activeView === 'networks') { chainShown = CHAIN_PAGE; renderChainsView(); }
    else if (activeView === 'incidents') renderIncidentList();
    else if (activeView === 'providers') renderProviderList();
}

function updateUrl({ push = false } = {}) {
    const u = new URL(location.href);
    const set = (k, v) => { if (v == null || v === '') u.searchParams.delete(k); else u.searchParams.set(k, v); };
    set('view', activeView === 'graph' ? null : activeView); // graph is the default; keep URL clean
    set('q', searchQuery || null);
    set('chain', openChainId);
    history[push ? 'pushState' : 'replaceState'](null, '', u);
}

// Restore view + query + open-chain from the URL (on load and on back/forward).
function applyUrlState() {
    const params = new URLSearchParams(location.search);
    const q = params.get('q') || '';
    searchQuery = q.trim().toLowerCase();
    const input = document.getElementById('searchInput');
    if (input && input.value !== q) input.value = q;
    switchView(params.get('view') || 'graph', { fromUrl: true });

    const chain = params.get('chain');
    if (chain && state.byId.has(Number(chain))) openChainDetail(Number(chain), { fromUrl: true });
    else closeDrawer({ fromUrl: true });
}

// ─────────────────────────────── search (global) ───────────────────────────────
function initSearch() {
    const input = document.getElementById('searchInput');
    const dd = document.getElementById('searchDropdown');
    let activeIdx = -1;

    // A jump-to-network autocomplete on every view (select → open detail). On
    // Networks/Incidents the same query also filters the page.
    const renderDropdown = debounce(q => {
        if (!q) { dd.classList.add('hidden'); return; }
        const matches = state.chains.filter(c =>
            String(c.chainId).includes(q) || c.name?.toLowerCase().includes(q) || c.shortName?.toLowerCase().includes(q)
        ).sort((a, b) => {
            const an = (a.name || '').toLowerCase(), bn = (b.name || '').toLowerCase();
            const as = an.startsWith(q), bs = bn.startsWith(q);
            if (as !== bs) return as ? -1 : 1;
            return an.localeCompare(bn);
        }).slice(0, 40);
        dd.textContent = ''; activeIdx = -1;
        if (!matches.length) dd.appendChild(el('div', { class: 'dropdown-empty', text: 'No networks found.' }));
        for (const c of matches) {
            dd.appendChild(el('div', { class: 'dropdown-item', 'data-id': c.chainId, onclick: () => pick(c.chainId) }, [
                networkIcon(c.name, COLORS[classify(c)], 'dropdown-icon'),
                el('div', { class: 'dropdown-info' }, [
                    el('span', { class: 'dropdown-name', text: c.name || `Chain ${c.chainId}` }),
                    el('div', { class: 'dropdown-meta', text: `ID: ${c.chainId} · ${(c.tags || []).join(', ') || classify(c)}` })
                ])
            ]));
        }
        dd.classList.remove('hidden');
    }, 140);

    function onInput(raw) {
        searchQuery = raw.trim().toLowerCase();
        updateUrl();           // ?q= reflects the search (shareable / reloadable)
        applySearch();         // filter the active page (networks / incidents)
        renderDropdown(searchQuery);
    }
    function pick(id) { dd.classList.add('hidden'); openChainDetail(id); if (activeView === 'graph') focusNodeById(id); }
    globalThis.pickChain = pick;

    input.addEventListener('input', e => onInput(e.target.value));
    input.addEventListener('keydown', e => {
        const items = dd.querySelectorAll('.dropdown-item');
        if (e.key === 'ArrowDown' && items.length) { e.preventDefault(); activeIdx = Math.min(activeIdx + 1, items.length - 1); mark(items); }
        else if (e.key === 'ArrowUp' && items.length) { e.preventDefault(); activeIdx = Math.max(activeIdx - 1, 0); mark(items); }
        else if (e.key === 'Enter') { e.preventDefault(); const t = items[activeIdx] || items[0]; if (t) pick(Number(t.dataset.id)); }
        else if (e.key === 'Escape') { dd.classList.add('hidden'); input.blur(); }
    });
    function mark(items) { items.forEach((it, i) => it.classList.toggle('active', i === activeIdx)); items[activeIdx]?.scrollIntoView({ block: 'nearest' }); }
    document.addEventListener('click', e => { if (!e.target.closest('.search-box')) dd.classList.add('hidden'); });
    document.addEventListener('keydown', e => { if (e.key === '/' && document.activeElement !== input) { e.preventDefault(); input.focus(); } });
}

// ─────────────────────────────── graph ───────────────────────────────
function initGraphControls() {
    document.querySelectorAll('.filter-btn').forEach(btn => btn.addEventListener('click', e => {
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
        currentFilter = e.currentTarget.dataset.filter; applyGraphFilter();
    }));
    const toggle = document.getElementById('sourcesToggle');
    const ddrop = document.getElementById('sourcesDropdown');
    toggle?.addEventListener('click', () => ddrop.classList.toggle('hidden'));
    document.addEventListener('click', e => { if (!e.target.closest('#sourcesPanel')) ddrop?.classList.add('hidden'); });
    ddrop?.querySelectorAll('input[data-source]').forEach(cb => cb.addEventListener('change', () => {
        cb.checked ? enabledSources.add(cb.dataset.source) : enabledSources.delete(cb.dataset.source);
        buildGraph(); applyGraphFilter();
    }));
}
function visibleChains() {
    if (enabledSources.size === ALL_SOURCES.length) return state.chains;
    return state.chains.filter(c => c.sources?.some(s => enabledSources.has(s)));
}
function buildGraph() {
    const chains = visibleChains();
    const ids = new Set(chains.map(c => c.chainId));
    const nodes = []; const nodeMap = new Map();
    for (const c of chains) {
        const type = classify(c);
        let name = c.name || `Chain ${c.chainId}`;
        if (type === 'Testnet' && !name.toLowerCase().includes('testnet')) name += ' Testnet';
        const val = type === 'Mainnet' ? (c.chainId === 1 ? 8 : 3) : type === 'L2' ? 1.8 : type === 'Beacon' ? 1.5 : 1;
        const node = { id: c.chainId, name, val, color: COLORS[type], type };
        nodes.push(node); nodeMap.set(c.chainId, node);
    }
    const links = [];
    for (const c of chains) {
        const e = state.rel.get(c.chainId); if (!e) continue;
        if (e.l1Parent != null && ids.has(e.l1Parent)) links.push({ source: c.chainId, target: e.l1Parent, kind: 'l2Of' });
        if (e.mainnet != null && ids.has(e.mainnet)) links.push({ source: c.chainId, target: e.mainnet, kind: 'testnetOf' });
    }
    graphData = { nodes, links };
    filteredData = { nodes: [...nodes], links: [...links] };
    if (!graphBuilt) { renderGraph(); graphBuilt = true; document.getElementById('loadingOverlay')?.classList.add('hidden'); }
}
function linksFor(idSet, exclude) {
    return graphData.links.filter(l => {
        const s = l.source.id ?? l.source, t = l.target.id ?? l.target;
        return idSet.has(s) && idSet.has(t) && (!exclude || l.kind !== exclude);
    });
}
function applyGraphFilter() {
    if (currentFilter === 'all') filteredData = { nodes: [...graphData.nodes], links: [...graphData.links] };
    else {
        const set = new Set();
        for (const n of graphData.nodes) if (n.type === currentFilter) {
            set.add(n.id);
            const e = state.rel.get(n.id);
            if (e?.l1Parent != null) set.add(e.l1Parent);
            if (e?.mainnet != null) set.add(e.mainnet);
        }
        filteredData = { nodes: graphData.nodes.filter(n => set.has(n.id)), links: linksFor(set) };
    }
    if (myGraph) myGraph.graphData(filteredData);
}
function renderGraph() {
    myGraph = ForceGraph3D()(document.getElementById('3d-graph'))
        .graphData(filteredData)
        .nodeLabel('name').nodeColor('color').nodeVal('val').nodeResolution(12).nodeOpacity(0.9)
        .linkColor(l => l.kind === 'l2Of' ? 'rgba(139,92,246,0.4)' : l.kind === 'testnetOf' ? 'rgba(245,158,11,0.4)' : 'rgba(255,255,255,0.1)')
        .linkWidth(0.8)
        .linkDirectionalParticles(l => (l.kind === 'l2Of' || l.kind === 'testnetOf') ? 2 : 0)
        .linkDirectionalParticleSpeed(0.004).linkDirectionalParticleWidth(1.5)
        .linkDirectionalParticleColor(l => l.kind === 'l2Of' ? 'rgba(139,92,246,0.7)' : 'rgba(245,158,11,0.7)')
        .backgroundColor('#060608').warmupTicks(80).cooldownTicks(60)
        .onNodeClick(n => { focusNode(n); openChainDetail(n.id); });
    window.addEventListener('resize', () => myGraph && myGraph.width(window.innerWidth).height(window.innerHeight));
}
function focusNode(node) {
    if (!myGraph || node.x == null) return;
    const r = 1 + 150 / Math.hypot(node.x, node.y, node.z);
    myGraph.cameraPosition({ x: node.x * r, y: node.y * r, z: node.z * r }, node, 1200);
}
function focusNodeById(id) { const n = filteredData.nodes.find(x => x.id === id) || graphData.nodes.find(x => x.id === id); if (n) focusNode(n); }

// ─────────────────────────────── summary metric strip ───────────────────────────────
function totalTvs() { return state.l2beatProjects.reduce((s, p) => s + (p.tvs || 0), 0); }
function renderSummaryCards() {
    const wrap = document.getElementById('summaryCards'); if (!wrap) return;
    const s = stats || {};
    const num = v => (v != null ? Number(v).toLocaleString() : '—');
    const tvs = totalTvs();
    const cards = [
        { label: 'Networks', value: num(s.totalChains ?? state.chains.length) },
        { label: 'Mainnets', value: num(s.totalMainnets) },
        { label: 'L2s', value: num(s.totalL2s) },
        { label: 'Testnets', value: num(s.totalTestnets) },
        { label: 'RPC working', value: s.rpc ? `${s.rpc.healthPercent}%` : '—', sub: s.rpc ? `${num(s.rpc.working)} / ${num(s.rpc.tested)}` : '', tone: 'good' },
        { label: 'Total TVS', value: tvs ? fmtUsd(tvs) : '—', sub: state.l2beatProjects.length ? `${state.l2beatProjects.length} L2BEAT projects` : '' }
    ];
    wrap.textContent = '';
    for (const c of cards) {
        wrap.appendChild(el('div', { class: `stat-card ${c.tone || ''}` }, [
            el('div', { class: 'stat-value', text: c.value }),
            el('div', { class: 'stat-label', text: c.label }),
            c.sub ? el('div', { class: 'stat-sub', text: c.sub }) : null
        ]));
    }
}

// ─────────────────────────────── Chains table ───────────────────────────────
let chainSort = { key: 'chainId', dir: 1 };
let chainTagFilter = 'all';
const CHAIN_PAGE = 200;
let chainShown = CHAIN_PAGE;

function initChainsTableHeader() {
    document.querySelectorAll('#chainsTable thead th[data-sort]').forEach(th => th.addEventListener('click', () => {
        const k = th.dataset.sort; chainSort.dir = chainSort.key === k ? -chainSort.dir : 1; chainSort.key = k; renderChainsView();
    }));
    document.querySelectorAll('#chainTagChips .chip').forEach(chip => chip.addEventListener('click', () => {
        document.querySelectorAll('#chainTagChips .chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active'); chainTagFilter = chip.dataset.tag; chainShown = CHAIN_PAGE; renderChainsView();
    }));
}
// Type = the environment (Mainnet/Testnet). L2 / Beacon / ZK / Validium /
// Optimium are orthogonal tags — a chain can be a mainnet-L2 or a testnet-L2.
function networkType(c) { return c.tags?.includes('Testnet') ? 'Testnet' : 'Mainnet'; }
function extraTags(c) { return (c.tags || []).filter(t => t !== 'Testnet'); }

function chainRowData(c) {
    const rpcCount = (c.rpc || []).filter(u => { const url = typeof u === 'string' ? u : u?.url; return url && url.startsWith('http') && !url.includes('${'); }).length;
    const l2b = state.l2beat.get(c.chainId);
    return {
        chainId: c.chainId, name: c.name || `Chain ${c.chainId}`,
        type: networkType(c), tags: extraTags(c), stage: l2b?.stage || '',
        rpcs: rpcCount, tvs: l2b?.tvs ?? null, status: c.status || ''
    };
}
function renderChainsView() {
    const body = document.getElementById('chainsTableBody'); if (!body) return;
    const q = searchQuery;
    let rows = state.chains.filter(c => {
        if (chainTagFilter !== 'all') {
            if (chainTagFilter === 'Mainnet') { if (networkType(c) !== 'Mainnet') return false; }      // env: not a testnet (incl. mainnet-L2s)
            else if (chainTagFilter === 'Testnet') { if (!c.tags?.includes('Testnet')) return false; }  // env: testnet (incl. testnet-L2s)
            else if (!c.tags?.includes(chainTagFilter)) return false;                                   // tag membership: L2 / Beacon / ZK …
        }
        if (q && !(`${c.chainId}`.includes(q) || c.name?.toLowerCase().includes(q) || c.shortName?.toLowerCase().includes(q))) return false;
        return true;
    }).map(chainRowData);

    const { key, dir } = chainSort;
    rows.sort((a, b) => {
        let av = a[key], bv = b[key];
        if (key === 'tvs') { av = av ?? -1; bv = bv ?? -1; }
        if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
        return String(av).localeCompare(String(bv)) * dir;
    });

    document.getElementById('chainsCount').textContent = `${rows.length.toLocaleString()} shown`;
    body.textContent = '';
    for (const r of rows.slice(0, chainShown)) {
        body.appendChild(el('tr', { 'data-id': r.chainId, onclick: () => openChainDetail(r.chainId) }, [
            el('td', { class: 'num mono', text: String(r.chainId) }),
            el('td', {}, [el('span', { class: 'cell-name', text: r.name })]),
            el('td', {}, [
                el('span', { class: `tag tag-${r.type.toLowerCase()}`, text: r.type }),
                ...r.tags.map(t => el('span', { class: `tag tag-${t.toLowerCase()}`, text: t }))
            ]),
            el('td', {}, [r.stage ? el('span', { class: 'pill pill-stage', text: r.stage }) : el('span', { class: 'muted', text: '—' })]),
            el('td', { class: 'num', text: r.tvs != null ? fmtUsd(r.tvs) : '—' }),
            el('td', { class: 'num', text: r.rpcs ? String(r.rpcs) : '—' }),
            el('td', {}, [statusBadge(r.status)])
        ]));
    }
    const more = document.getElementById('chainsTableMore'); more.textContent = '';
    if (rows.length > chainShown) more.appendChild(el('button', { class: 'load-more', text: `Show more (${(rows.length - chainShown).toLocaleString()} remaining)`, onclick: () => { chainShown += CHAIN_PAGE * 2; renderChainsView(); } }));
}
function statusBadge(status) {
    if (!status) return el('span', { class: 'muted', text: '—' });
    return el('span', { class: `pill pill-${status.toLowerCase()}`, text: status });
}

// ─────────────────────────────── Top-L2s TVS chart ───────────────────────────────
function renderScalingChart() {
    const wrap = document.getElementById('scalingChart'); if (!wrap) return;
    const top = state.l2beatProjects.filter(p => p.tvs > 0).sort((a, b) => b.tvs - a.tvs).slice(0, 15);
    if (state.l2beatMeta) document.getElementById('scalingMeta').textContent = `${state.l2beatMeta.count} projects · ${state.l2beatMeta.source}`;
    wrap.textContent = '';
    if (!top.length) { wrap.appendChild(el('div', { class: 'feed-empty', text: 'No scaling data.' })); return; }
    const max = top[0].tvs;
    for (const p of top) {
        const pct = Math.max(2, (p.tvs / max) * 100);
        const row = el('div', { class: 'bar-row', onclick: p.chainId != null ? () => openChainDetail(p.chainId) : null }, [
            el('div', { class: 'bar-label', text: p.displayName || p.slug }),
            el('div', { class: 'bar-track' }, [el('div', { class: 'bar-fill' })]),
            el('div', { class: 'bar-value mono', text: fmtUsd(p.tvs) })
        ]);
        const fill = row.querySelector('.bar-fill');
        fill.style.width = `${pct}%`;
        fill.style.background = `linear-gradient(90deg, var(--color-l2), #06b6d4)`;
        wrap.appendChild(row);
    }
}

// ─────────────────────────────── status pages (drawer links only) ───────────────────────────────
async function loadStatusPages() {
    try {
        const d = await api('/status-pages');
        for (const sp of d.statusPages || []) for (const id of sp.chainIds || []) state.statusPagesByChain.set(id, { id: sp.id, name: sp.name, url: sp.url });
    } catch { /* drawer just won't show a status link */ }
}

// ─────────────────────────────── Incidents (live WS) ───────────────────────────────
const STATUS_WORDS = ['Resolved', 'Completed', 'Monitoring', 'Verifying', 'Update', 'Identified', 'Investigating', 'Scheduled', 'In progress'];
// Statuses that close an incident/maintenance — used to know it's done.
const CLOSED_STATUSES = new Set(['resolved', 'completed', 'closed']);
const incidents = { items: [], byKey: new Map(), ws: null, retries: 0, groupBy: 'flat', dayFilter: null, category: 'all' };
const providers = { filter: 'all' };

function parseIncidentStatus(ev) {
    const s = ev.summary || '';
    const m = s.match(new RegExp(`<strong>\\s*(${STATUS_WORDS.join('|')})\\s*</strong>`, 'i'));
    if (m) return m[1];
    const m2 = s.match(/Status:\s*([a-z ]+?)(?:\s*\||$)/i);
    if (m2) return m2[1].trim();
    return null;
}
// Incident vs scheduled maintenance. Incident lifecycle words win (so an
// "Investigating…" event isn't miscategorised); otherwise maintenance/upgrade
// signals mark it scheduled.
function classifyKind(ev) {
    const blob = `${ev.title || ''} ${ev.summary || ''}`;
    if (/\b(Investigating|Identified|Monitoring)\b/i.test(blob)) return 'incident';
    if (/\b(Scheduled|Maintenance|Verifying|Completed|In progress)\b/i.test(blob) || /maintenance|upgrade|planned/i.test(ev.title || '')) return 'scheduled';
    return 'incident';
}
function parseIncidentTimes(ev) {
    const s = ev.summary || '';
    const year = (ev.publishedAt ? new Date(ev.publishedAt) : new Date()).getUTCFullYear();
    const stamps = [...s.matchAll(/<small>([\s\S]*?)<\/small>/gi)]
        .map(x => {
            // Pull the visible tokens (month word, day, HH:MM) directly from the
            // <small> content — e.g. "Jun <var…>26</var>, <var…>20:03</var> UTC".
            // We only need to parse a date, so extract tokens instead of
            // stripping tags (tag-stripping is brittle and only used here for
            // a non-HTML purpose).
            const inner = x[1];
            const month = (inner.match(/[A-Za-z]{3,}/) || [])[0];
            const nums = inner.match(/\d{1,2}:\d{2}|\d{1,2}/g) || [];
            const day = nums.find(n => !n.includes(':'));
            const time = nums.find(n => n.includes(':'));
            if (!month || !day || !time) return null;
            const d = new Date(`${month} ${day} ${year} ${time}:00 UTC`);
            return Number.isNaN(d.getTime()) ? null : d.getTime();
        }).filter(v => v != null);
    if (stamps.length >= 2) return { start: Math.min(...stamps), end: Math.max(...stamps) };
    // ISO fallback (e.g. "Resolved: 2026-06-26 18:49:13")
    const iso = [...s.matchAll(/(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2})/g)].map(x => Date.parse(x[1].replace(' ', 'T') + 'Z')).filter(Boolean);
    if (iso.length >= 2) return { start: Math.min(...iso), end: Math.max(...iso) };
    return null;
}
// One incident = one block, keyed by status page + title. The feed emits a
// separate event per poll/update for the same incident; we merge them, keep the
// latest status, and measure the open span across all the events we've seen.
function incidentKey(ev) {
    const sp = ev.statusPage?.id || (ev.chains?.[0]?.chainId ?? 'unknown');
    return `${sp}|${(ev.title || '').toLowerCase().trim()}`;
}
function eventTimeMs(ev) {
    const t = Date.parse(ev.publishedAt || ev.updatedAt || '');
    return Number.isNaN(t) ? null : t;
}
function incidentModel(ev) {
    const chain = ev.chains?.[0];
    const whenMs = eventTimeMs(ev);
    const isProvider = ev.statusPage?.kind === 'rpc-provider';
    return {
        key: incidentKey(ev),
        title: ev.title || '(untitled)',
        url: ev.url,
        whenMs,
        firstSeen: whenMs,
        lastSeen: whenMs,
        status: parseIncidentStatus(ev),
        kind: classifyKind(ev),
        durationMs: (() => { const t = parseIncidentTimes(ev); return t ? t.end - t.start : null; })(),
        netName: chain?.name || ev.statusPage?.name || ev.statusPage?.id || 'Unknown',
        chainId: chain?.chainId ?? null,
        spId: ev.statusPage?.id || (chain?.chainId != null ? String(chain.chainId) : 'unknown'),
        // RPC provider incidents (Infura, QuickNode, dRPC, Pinax) get their own
        // tab; one provider status page can affect many chains per incident.
        isProvider,
        provider: isProvider ? (ev.statusPage?.id || 'unknown') : null,
        providerName: isProvider ? (ev.statusPage?.name || ev.statusPage?.id || 'Provider') : null,
        affectedChains: isProvider ? (ev.chains || []).map(c => c.chainId).filter(id => id != null) : [],
        affectedComponents: Array.isArray(ev.affectedComponents) ? ev.affectedComponents : []
    };
}
function dayKey(ms) { return ms != null && !Number.isNaN(ms) ? new Date(ms).toISOString().slice(0, 10) : null; }

function addIncidents(events) {
    let changed = false;
    for (const ev of events) {
        const m = incidentModel(ev);
        const existing = incidents.byKey.get(m.key);
        if (!existing) { incidents.byKey.set(m.key, m); changed = true; continue; }
        // merge into the single block for this incident
        if (m.whenMs != null) {
            existing.firstSeen = Math.min(existing.firstSeen ?? m.whenMs, m.whenMs);
            existing.lastSeen = Math.max(existing.lastSeen ?? m.whenMs, m.whenMs);
            if (existing.whenMs == null || m.whenMs >= existing.whenMs) { // newest event wins for current status
                existing.whenMs = m.whenMs; existing.status = m.status; existing.url = m.url; existing.kind = m.kind;
                if (m.affectedChains.length) existing.affectedChains = m.affectedChains;
                if (m.affectedComponents.length) existing.affectedComponents = m.affectedComponents;
            }
        }
        changed = true;
    }
    if (!changed) return;
    for (const m of incidents.byKey.values()) {
        // Prefer the observed open span (first→last update); fall back to the
        // duration parsed from a single summary.
        if (m.firstSeen != null && m.lastSeen != null && m.lastSeen > m.firstSeen) m.durationMs = m.lastSeen - m.firstSeen;
    }
    incidents.items = [...incidents.byKey.values()].sort((a, b) => (b.whenMs || 0) - (a.whenMs || 0));
    try { renderIncidents(); } catch (err) { console.error('incident render failed', err); }
    try { renderProviders(); } catch (err) { console.error('provider render failed', err); }
}

// The Incidents tab covers chain operator status pages; RPC provider status
// pages live in their own Providers tab. Items after the active category filter.
function visibleIncidents() {
    const chainIncidents = incidents.items.filter(it => !it.isProvider);
    if (incidents.category === 'all') return chainIncidents;
    return chainIncidents.filter(it => it.kind === incidents.category);
}

function initIncidentControls() {
    document.getElementById('grpFlat')?.addEventListener('click', () => setGroupBy('flat'));
    document.getElementById('grpNetwork')?.addEventListener('click', () => setGroupBy('network'));
    document.querySelectorAll('#incidentCategory .chip').forEach(chip =>
        chip.addEventListener('click', () => setCategory(chip.dataset.cat)));
}
function setGroupBy(mode) {
    incidents.groupBy = mode;
    document.getElementById('grpFlat')?.classList.toggle('active', mode === 'flat');
    document.getElementById('grpNetwork')?.classList.toggle('active', mode === 'network');
    renderIncidentList();
}
function setCategory(cat) {
    incidents.category = cat;
    document.querySelectorAll('#incidentCategory .chip').forEach(c => c.classList.toggle('active', c.dataset.cat === cat));
    renderIncidents();
}

function renderIncidents() {
    renderCalendar();
    renderIncidentList();
}

function renderCalendar() {
    const cal = document.getElementById('incidentCalendar'); if (!cal) return;
    const counts = new Map();
    for (const it of visibleIncidents()) { const k = dayKey(it.whenMs); if (k) counts.set(k, (counts.get(k) || 0) + 1); }
    const max = Math.max(1, ...counts.values());
    cal.textContent = '';
    const today = new Date(); today.setUTCHours(0, 0, 0, 0);
    for (let i = 29; i >= 0; i--) {
        const d = new Date(today); d.setUTCDate(today.getUTCDate() - i);
        const k = d.toISOString().slice(0, 10); const n = counts.get(k) || 0;
        const cell = el('div', { class: `cal-cell${n ? ' has' : ''}${incidents.dayFilter === k ? ' sel' : ''}`, title: `${k}: ${n} incident${n === 1 ? '' : 's'}` }, [
            el('span', { class: 'cal-day', text: String(d.getUTCDate()) }),
            n ? el('span', { class: 'cal-count', text: String(n) }) : null
        ]);
        if (n) { cell.style.background = `rgba(139,92,246,${0.15 + 0.6 * (n / max)})`; cell.addEventListener('click', () => { incidents.dayFilter = incidents.dayFilter === k ? null : k; renderIncidents(); }); }
        cal.appendChild(cell);
    }
}

function incidentCard(it) {
    const open = it.status && !CLOSED_STATUSES.has(it.status.toLowerCase());
    const when = it.whenMs != null ? new Date(it.whenMs).toLocaleString() : null;
    const meta = [it.netName, when, open ? 'ongoing' : null].filter(Boolean);
    const dur = fmtDuration(it.durationMs);
    const side = [];
    if (it.status) side.push(el('span', { class: `pill st-${it.status.toLowerCase().replace(/\s+/g, '')}`, text: it.status }));
    if (dur) side.push(el('span', { class: 'incident-dur', text: dur }));
    return el('a', { class: `incident-card${open ? ' open' : ''}`, href: it.url || '#', target: '_blank', rel: 'noopener' }, [
        networkIcon(it.netName, iconColorFor(it.chainId)),
        el('div', { class: 'incident-body' }, [
            el('div', { class: 'incident-title' }, [
                it.kind === 'scheduled' ? el('span', { class: 'kind-tag', text: 'Scheduled' }) : null,
                el('span', { text: it.title })
            ]),
            el('div', { class: 'incident-meta', text: meta.join(' · ') })
        ]),
        el('div', { class: 'incident-side' }, side)
    ]);
}

function renderIncidentList() {
    const list = document.getElementById('incidentsList'); if (!list) return;
    let items = visibleIncidents();
    if (incidents.dayFilter) items = items.filter(it => dayKey(it.whenMs) === incidents.dayFilter);
    if (searchQuery) items = items.filter(it => it.netName?.toLowerCase().includes(searchQuery) || it.title?.toLowerCase().includes(searchQuery) || String(it.chainId).includes(searchQuery));
    const noun = incidents.category === 'scheduled' ? 'maintenance' : 'incident';
    document.getElementById('incidentsCount').textContent =
        `${items.length} ${noun}${items.length === 1 ? '' : 's'}${incidents.dayFilter ? ` on ${incidents.dayFilter}` : ''}${searchQuery ? ` · “${searchQuery}”` : ''}`;
    list.textContent = '';
    if (!items.length) { list.appendChild(el('div', { class: 'feed-empty', text: 'Nothing in this range.' })); return; }

    if (incidents.groupBy === 'network') {
        const groups = new Map();
        for (const it of items) { if (!groups.has(it.spId)) groups.set(it.spId, []); groups.get(it.spId).push(it); }
        const ordered = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
        for (const [, arr] of ordered) {
            const head = arr[0];
            list.appendChild(el('div', { class: 'incident-group-head' }, [
                networkIcon(head.netName, iconColorFor(head.chainId), 'net-icon sm'),
                el('span', { class: 'cell-name', text: head.netName }),
                el('span', { class: 'muted', text: `${arr.length} event${arr.length === 1 ? '' : 's'}` })
            ]));
            for (const it of arr) list.appendChild(incidentCard(it));
        }
    } else {
        for (const it of items) list.appendChild(incidentCard(it));
    }
}

// ─────────────────────────────── RPC providers (live WS) ───────────────────────────────
// Same feed as Incidents; provider items (statusPage.kind === 'rpc-provider')
// are split out here and grouped by provider, each showing the chains it hit.
function providerIncidents() { return incidents.items.filter(it => it.isProvider); }
function visibleProviderIncidents() {
    const all = providerIncidents();
    return providers.filter === 'all' ? all : all.filter(it => it.provider === providers.filter);
}
function providerMatchesSearch(it, q) {
    if (it.providerName?.toLowerCase().includes(q) || it.title?.toLowerCase().includes(q)) return true;
    if ((it.affectedComponents || []).some(c => c.toLowerCase().includes(q))) return true;
    return (it.affectedChains || []).some(id => String(id).includes(q) || state.byId.get(id)?.name?.toLowerCase().includes(q));
}

function setProviderFilter(prov) {
    providers.filter = prov;
    renderProviderFilter();
    renderProviderList();
}

function renderProviders() {
    renderProviderFilter();
    renderProviderList();
}

function renderProviderFilter() {
    const bar = document.getElementById('providerFilter'); if (!bar) return;
    const all = providerIncidents();
    const counts = new Map(), names = new Map();
    for (const it of all) { counts.set(it.provider, (counts.get(it.provider) || 0) + 1); if (!names.has(it.provider)) names.set(it.provider, it.providerName); }
    bar.textContent = '';
    const chip = (prov, label) => el('button', { class: `chip${providers.filter === prov ? ' active' : ''}`, 'data-prov': prov, onclick: () => setProviderFilter(prov), text: label });
    bar.appendChild(chip('all', `All (${all.length})`));
    for (const [id, name] of [...names].sort((a, b) => (a[1] || '').localeCompare(b[1] || '')))
        bar.appendChild(chip(id, `${name} (${counts.get(id) || 0})`));
}

function providerCard(it) {
    const open = it.status && !CLOSED_STATUSES.has(it.status.toLowerCase());
    const when = it.whenMs != null ? new Date(it.whenMs).toLocaleString() : null;
    const meta = [it.providerName, when, open ? 'ongoing' : null].filter(Boolean);
    const dur = fmtDuration(it.durationMs);
    const side = [];
    if (it.status) side.push(el('span', { class: `pill st-${it.status.toLowerCase().replace(/\s+/g, '')}`, text: it.status }));
    if (dur) side.push(el('span', { class: 'incident-dur', text: dur }));
    // Affected chains as clickable chips (open the chain drawer); fall back to
    // raw component names when no chain mapped, or a "provider-wide" note.
    let affected = null;
    if (it.affectedChains?.length) {
        affected = el('div', { class: 'affected-chains' }, it.affectedChains.slice(0, 12).map(id => {
            const c = state.byId.get(id);
            return el('span', { class: 'chain-chip', onclick: e => { e.preventDefault(); e.stopPropagation(); openChainDetail(id); }, text: c?.name || `Chain ${id}` });
        }));
    } else if (it.affectedComponents?.length) {
        affected = el('div', { class: 'incident-meta muted', text: it.affectedComponents.slice(0, 5).join(', ') });
    } else {
        affected = el('div', { class: 'incident-meta muted', text: 'No specific chain — provider-wide' });
    }
    return el('a', { class: `incident-card${open ? ' open' : ''}`, href: it.url || '#', target: '_blank', rel: 'noopener' }, [
        networkIcon(it.providerName, COLORS.Default, 'net-icon provider-icon'),
        el('div', { class: 'incident-body' }, [
            el('div', { class: 'incident-title' }, [el('span', { text: it.title })]),
            el('div', { class: 'incident-meta', text: meta.join(' · ') }),
            affected
        ]),
        el('div', { class: 'incident-side' }, side)
    ]);
}

function renderProviderList() {
    const list = document.getElementById('providersList'); if (!list) return;
    let items = visibleProviderIncidents();
    if (searchQuery) items = items.filter(it => providerMatchesSearch(it, searchQuery));
    const countEl = document.getElementById('providersCount');
    if (countEl) countEl.textContent = `${items.length} incident${items.length === 1 ? '' : 's'}${searchQuery ? ` · “${searchQuery}”` : ''}`;
    list.textContent = '';
    if (!items.length) {
        list.appendChild(el('div', { class: 'feed-empty', text: providerIncidents().length ? 'Nothing matches.' : 'No RPC provider incidents in range.' }));
        return;
    }
    for (const it of items) list.appendChild(providerCard(it));
}

function connectStatusFeed() {
    const wsUrl = `${STATUS_NEWS_BASE.replace(/^http/, 'ws')}/ws?replay=200`;
    let ws;
    try { ws = new WebSocket(wsUrl); } catch { return statusFeedRestFallback(); }
    incidents.ws = ws;
    ws.onopen = () => { incidents.retries = 0; setFeedMeta('live'); };
    ws.onmessage = ev => { let m; try { m = JSON.parse(ev.data); } catch { return; } if (m.type === 'status.item' && m.item) addIncidents([m.item]); };
    ws.onerror = () => { try { ws.close(); } catch { /* noop */ } };
    ws.onclose = () => {
        incidents.ws = null;
        if (!incidents.items.length && !incidents.restTried) statusFeedRestFallback();
        if (incidents.retries < 6) { const delay = Math.min(1000 * 2 ** incidents.retries, 20000); incidents.retries++; setFeedMeta('reconnecting…'); setTimeout(connectStatusFeed, delay); }
    };
}
function setFeedMeta(text) {
    for (const id of ['incidentsMeta', 'providersMeta']) { const e = document.getElementById(id); if (e) e.textContent = text; }
}
async function statusFeedRestFallback() {
    incidents.restTried = true;
    try {
        const res = await fetch(`${STATUS_NEWS_BASE}/events?limit=200`, { headers: { accept: 'application/json' } });
        if (!res.ok) throw new Error(res.status);
        const d = await res.json();
        addIncidents(d.events || d.items || []);
    } catch {
        if (!incidents.items.length) { const l = document.getElementById('incidentsList'); if (l) { l.textContent = ''; l.appendChild(el('div', { class: 'feed-empty', text: 'Live status feed unavailable (chains-status-news).' })); } }
    }
}

// ─────────────────────────────── Detail drawer ───────────────────────────────
function initDrawer() {
    document.getElementById('closeDrawer')?.addEventListener('click', () => closeDrawer());
    document.getElementById('drawerScrim')?.addEventListener('click', () => closeDrawer());
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDrawer(); });
}
function closeDrawer(opts = {}) {
    document.getElementById('detailDrawer')?.classList.add('hidden');
    stopBlockHead();
    openChainId = null;
    if (!opts.fromUrl) updateUrl();
}
function chainLink(id) {
    const c = state.byId.get(id);
    return el('a', { class: 'chip-link', href: '#', text: c?.name || `Chain ${id}`, onclick: e => { e.preventDefault(); openChainDetail(id); } });
}
function detailRow(label, valueNode) {
    return el('div', { class: 'd-row' }, [el('span', { class: 'd-label', text: label }), el('div', { class: 'd-value' }, [].concat(valueNode))]);
}
function openChainDetail(chainId, opts = {}) {
    const c = state.byId.get(chainId); if (!c) return;
    openChainId = chainId;
    if (!opts.fromUrl) updateUrl();
    const body = document.getElementById('drawerBody');
    const type = classify(c);
    const e = state.rel.get(chainId) || {};
    const l2b = state.l2beat.get(chainId);
    const sp = state.statusPagesByChain.get(chainId);
    body.textContent = '';

    const icon = networkIcon(c.name, COLORS[type], 'd-icon');
    const badges = [el('span', { class: 'badge', text: `ID: ${c.chainId}` })];
    if (c.status) badges.push(statusBadge(c.status));
    (c.tags || []).forEach(t => badges.push(el('span', { class: `tag tag-${t.toLowerCase()}`, text: t })));
    body.appendChild(el('div', { class: 'd-header' }, [icon, el('div', {}, [
        el('h2', { text: c.name || `Chain ${c.chainId}` }), el('div', { class: 'd-badges' }, badges)
    ])]));

    const content = el('div', { class: 'd-content' });
    content.appendChild(detailRow('Native currency', el('span', { text: c.nativeCurrency ? `${c.nativeCurrency.name} (${c.nativeCurrency.symbol})` : '—' })));
    if (e.l1Parent != null) content.appendChild(detailRow('L1 / parent', chainLink(e.l1Parent)));
    if (e.mainnet != null) content.appendChild(detailRow('Mainnet', chainLink(e.mainnet)));
    if (e.l2Children?.length) content.appendChild(detailRow(`L2 / L3 (${e.l2Children.length})`, e.l2Children.slice(0, 30).map(chainLink)));
    if (e.testnetChildren?.length) content.appendChild(detailRow(`Testnets (${e.testnetChildren.length})`, e.testnetChildren.slice(0, 30).map(chainLink)));
    if (l2b) content.appendChild(detailRow('L2BEAT', el('div', { class: 'l2b-grid' }, [
        el('span', { class: 'pill pill-stage', text: l2b.stage || '—' }), el('span', { class: 'muted', text: l2b.category || '' }),
        el('span', { class: 'strong', text: fmtUsd(l2b.tvs) }), l2b.daLayer ? el('span', { class: 'muted', text: `DA: ${l2b.daLayer}` }) : null
    ])));
    if (sp) { const host = safeHost(sp.url); content.appendChild(detailRow('Status page', el('a', { href: sp.url, target: '_blank', rel: 'noopener', text: host || sp.name }))); }
    if (c.explorers?.length) content.appendChild(detailRow('Explorers', c.explorers.map(x => el('a', { href: x.url, target: '_blank', rel: 'noopener', text: x.name || safeHost(x.url) }))));
    if (c.infoURL) { const host = safeHost(c.infoURL); content.appendChild(detailRow('Website', host ? el('a', { href: c.infoURL, target: '_blank', rel: 'noopener', text: host }) : el('span', { text: c.infoURL }))); }
    if (c.slip44 != null) content.appendChild(detailRow('SLIP-44', el('span', { class: 'mono', text: String(c.slip44) })));

    const headCell = el('span', { class: 'mono', text: '…' });
    content.appendChild(detailRow('Block head', headCell));
    const rpcBox = el('div', { class: 'd-rpc' }, [el('div', { class: 'd-rpc-loading', text: 'Checking RPC endpoints…' })]);
    content.appendChild(detailRow('RPC endpoints', rpcBox));
    const clientBox = el('div', { class: 'd-clients muted', text: '—' });
    content.appendChild(detailRow('Clients (live)', clientBox));

    body.appendChild(content);
    document.getElementById('detailDrawer').classList.remove('hidden');
    loadLiveRpc(chainId, rpcBox, headCell);
    loadLiveClients(chainId, clientBox);
}
// "Geth/v1.13.0/linux/go1.21" → "Geth v1.13.0"
function clientNameVersion(cv) {
    if (!cv) return null;
    return String(cv).split('/').slice(0, 2).join(' ').trim() || null;
}
async function loadLiveRpc(chainId, box, headCell) {
    stopBlockHead();
    const staticUrls = (state.byId.get(chainId)?.rpc || []).map(u => typeof u === 'string' ? u : u?.url).filter(u => u && u.startsWith('http') && !u.includes('${'));
    let results = [];
    try { const d = await api(`/rpc-monitor/${chainId}`); results = d.results || d.endpoints || (Array.isArray(d) ? d : []); } catch { /* noop */ }
    const working = results.filter(r => r.status === 'working' || r.ok === true);
    // List only reachable endpoints (failed ones are ignored). If nothing has
    // been health-checked yet, fall back to the registry list as untested.
    const listed = working.length ? working : (results.length ? [] : staticUrls.map(u => ({ url: u })));
    box.textContent = '';
    if (listed.length) {
        for (const r of listed.slice(0, 20)) {
            const ver = clientNameVersion(r.clientVersion);
            box.appendChild(el('div', { class: 'rpc-row' }, [
                el('span', { class: 'dot dot-ok' }),
                el('span', { class: 'rpc-host mono', text: safeHost(r.url) || r.url }),
                ver ? el('span', { class: 'rpc-meta muted', text: ver }) : null
            ]));
        }
    } else {
        box.appendChild(el('span', { class: 'muted', text: 'No reachable endpoints.' }));
    }
    // Block head: poll one live endpoint client-side every 5s. Try working
    // first, then any registry endpoint (browser CORS can differ from the
    // server's reachability).
    const candidates = [...new Set([...working.map(r => r.url), ...staticUrls])];
    if (candidates.length) startBlockHead(candidates, headCell); else headCell.textContent = '—';
}
async function loadLiveClients(chainId, box) {
    try {
        const d = await api(`/clients/${chainId}`);
        const clients = d.clients || [];
        if (!clients.length) { box.textContent = 'No client data yet.'; return; }
        box.textContent = ''; box.classList.remove('muted');
        for (const cl of clients) {
            const v = (cl.versions || [])[0]?.version;
            const allVers = (cl.versions || []).map(x => `${x.version}${x.nodeCount ? ` ×${x.nodeCount}` : ''}`).join(', ');
            box.appendChild(el('span', { class: 'client-pill', title: allVers }, [
                `${cl.name}${v ? ' ' : ''}`,
                v ? el('span', { class: 'client-ver', text: v }) : null,
                cl.nodeCount ? el('span', { class: 'client-count', text: ` ×${cl.nodeCount}` }) : null
            ]));
        }
    } catch { box.textContent = '—'; }
}

// ─── client-side block-head polling (one endpoint, every 5s) ───
let blockHeadTimer = null;
let blockHeadToken = 0;
function stopBlockHead() { if (blockHeadTimer) { clearInterval(blockHeadTimer); blockHeadTimer = null; } }
async function rpcBlockNumber(url) {
    try {
        const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }) });
        if (!res.ok) return null;
        const d = await res.json();
        const n = typeof d.result === 'string' ? parseInt(d.result, 16) : null;
        return Number.isFinite(n) ? n : null;
    } catch { return null; }
}
function startBlockHead(urls, cell) {
    stopBlockHead();
    const token = ++blockHeadToken;
    let liveUrl = null;
    const poll = async () => {
        for (const u of (liveUrl ? [liveUrl, ...urls] : urls)) {
            const n = await rpcBlockNumber(u);
            if (token !== blockHeadToken) return;         // drawer changed/closed
            if (n != null) { liveUrl = u; cell.textContent = `#${n.toLocaleString()}`; cell.title = safeHost(u) || u; return; }
        }
        if (token === blockHeadToken && !liveUrl) cell.textContent = '—';
    };
    poll();
    blockHeadTimer = setInterval(poll, 5000);
}
