// ─────────────────────────────────────────────────────────────────────────
// Chains dashboard — relationships, chains, RPC & status, scaling.
// Data: live chains-api (/export bulk + per-chain endpoints) and
// chains-status-news (/events). Forum data is intentionally excluded for now.
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
    chains: [],
    byId: new Map(),
    rel: new Map(),                 // chainId -> {l1Parent, mainnet, l2Children[], testnetChildren[]}
    l2beat: new Map(),              // chainId -> l2beat project
    l2beatMeta: null,
    statusPagesByChain: new Map(),  // chainId -> {id,name,url}
    statusPages: [],
    lastUpdated: null
};

// graph state
let graphData = { nodes: [], links: [] };
let filteredData = { nodes: [], links: [] };
let currentFilter = 'all';
let enabledSources = new Set(ALL_SOURCES);
let myGraph = null;
let graphBuilt = false;

// ─── tiny DOM helper ───
function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'html') node.innerHTML = v;
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

function debounce(fn, ms) {
    let t;
    return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

function fmtUsd(n) {
    if (n == null || !Number.isFinite(n)) return '—';
    if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
    if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
    if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
    return `$${n.toFixed(0)}`;
}

function safeHost(url) {
    try {
        const u = new URL(url);
        return (u.protocol === 'http:' || u.protocol === 'https:') ? u.host : null;
    } catch { return null; }
}

async function api(path) {
    const res = await fetch(`${API_BASE}${path}`, { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`${path} → ${res.status}`);
    return res.json();
}

// ─────────────────────────────── bootstrap ───────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    initTabs();
    initSearch();
    initGraphControls();
    initDrawer();
    loadBulk();
    loadStatsLine();
});

async function loadStatsLine() {
    try {
        const s = await api('/stats');
        document.getElementById('statsLine').textContent =
            `${s.totalChains} chains · ${s.totalMainnets} mainnets · ${s.totalL2s} L2s · ${s.totalTestnets} testnets`;
        renderRpcStatCards(s);
    } catch { /* stats line stays as loaded count later */ }
}

async function loadBulk() {
    let payload;
    try {
        payload = await api('/export');
    } catch {
        try { payload = await (await fetch('export.json')).json(); }
        catch (e) { return graphLoadError(); }
    }
    const data = payload.data ?? payload;
    state.chains = data.indexed?.all ?? [];
    state.lastUpdated = data.lastUpdated ?? null;
    state.byId = new Map(state.chains.map(c => [c.chainId, c]));

    // L2BEAT projects keyed by chainId
    state.l2beatMeta = data.l2beat ? { source: data.l2beat.source, fetchedAt: data.l2beat.fetchedAt, count: (data.l2beat.projects || []).length } : null;
    for (const p of data.l2beat?.projects ?? []) {
        if (p.chainId != null) state.l2beat.set(p.chainId, p);
    }

    buildRelations();
    buildGraph();
    renderChainsView();
    renderScalingView();
    if (!document.getElementById('statsLine').textContent.includes('chains')) {
        document.getElementById('statsLine').textContent = `${state.chains.length} chains loaded`;
    }
    // status data (independent of bulk)
    loadStatusPages();
    connectStatusFeed();
}

function graphLoadError() {
    const o = document.getElementById('loadingOverlay');
    if (!o) return;
    o.querySelector('.spinner').style.display = 'none';
    o.querySelector('p').textContent = 'Failed to load data.';
    o.querySelector('.loading-sub').textContent = 'Check your connection or that the API is reachable.';
}

// ─── relations: derive parents/children per chain from chain.relations ───
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
    // de-dup children
    for (const e of state.rel.values()) {
        e.l2Children = [...new Set(e.l2Children)];
        e.testnetChildren = [...new Set(e.testnetChildren)];
    }
}

// ─────────────────────────────── tabs ───────────────────────────────
function initTabs() {
    document.querySelectorAll('#tabs .tab').forEach(btn => {
        btn.addEventListener('click', () => switchView(btn.dataset.view));
    });
}

function switchView(view) {
    document.querySelectorAll('#tabs .tab').forEach(b => b.classList.toggle('active', b.dataset.view === view));
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById(`view-${view}`).classList.add('active');
    document.body.classList.toggle('graph-active', view === 'graph');
    if (view === 'graph' && myGraph) { setTimeout(() => myGraph.width(window.innerWidth).height(window.innerHeight), 0); }
}

// ─────────────────────────────── search ───────────────────────────────
function initSearch() {
    const input = document.getElementById('searchInput');
    const dd = document.getElementById('searchDropdown');
    let activeIdx = -1;

    const render = debounce(q => {
        if (!q) { dd.classList.add('hidden'); return; }
        const matches = state.chains.filter(c =>
            String(c.chainId).includes(q) ||
            c.name?.toLowerCase().includes(q) ||
            c.shortName?.toLowerCase().includes(q)
        ).sort((a, b) => {
            const an = (a.name || '').toLowerCase(), bn = (b.name || '').toLowerCase();
            const as = an.startsWith(q), bs = bn.startsWith(q);
            if (as !== bs) return as ? -1 : 1;
            return an.localeCompare(bn);
        }).slice(0, 40);

        dd.textContent = '';
        activeIdx = -1;
        if (!matches.length) { dd.appendChild(el('div', { class: 'dropdown-empty', text: 'No chains found.' })); }
        for (const c of matches) {
            const color = COLORS[classify(c)];
            const item = el('div', { class: 'dropdown-item', 'data-id': c.chainId, onclick: () => pick(c.chainId) }, [
                el('div', { class: 'dropdown-icon', text: (c.name || '?').charAt(0).toUpperCase() }),
                el('div', { class: 'dropdown-info' }, [
                    el('span', { class: 'dropdown-name', text: c.name || `Chain ${c.chainId}` }),
                    el('div', { class: 'dropdown-meta', text: `ID: ${c.chainId} · ${(c.tags || []).join(', ') || classify(c)}` })
                ])
            ]);
            item.querySelector('.dropdown-icon').style.background = `linear-gradient(135deg, ${color}, ${color}44)`;
            dd.appendChild(item);
        }
        dd.classList.remove('hidden');
    }, 140);

    function pick(id) {
        input.value = state.byId.get(id)?.name || String(id);
        dd.classList.add('hidden');
        openChainDetail(id);
        if (document.body.classList.contains('graph-active')) focusNodeById(id);
    }
    globalThis.pickChain = pick;

    input.addEventListener('input', e => render(e.target.value.toLowerCase().trim()));
    input.addEventListener('keydown', e => {
        const items = dd.querySelectorAll('.dropdown-item');
        if (e.key === 'ArrowDown' && items.length) { e.preventDefault(); activeIdx = Math.min(activeIdx + 1, items.length - 1); markActive(items); }
        else if (e.key === 'ArrowUp' && items.length) { e.preventDefault(); activeIdx = Math.max(activeIdx - 1, 0); markActive(items); }
        else if (e.key === 'Enter') { e.preventDefault(); const t = items[activeIdx] || items[0]; if (t) pick(Number(t.dataset.id)); }
        else if (e.key === 'Escape') { dd.classList.add('hidden'); input.blur(); }
    });
    function markActive(items) { items.forEach((it, i) => it.classList.toggle('active', i === activeIdx)); items[activeIdx]?.scrollIntoView({ block: 'nearest' }); }

    document.addEventListener('click', e => { if (!e.target.closest('.search-box')) dd.classList.add('hidden'); });
    document.addEventListener('keydown', e => {
        if (e.key === '/' && document.activeElement !== input) { e.preventDefault(); input.focus(); }
    });
}

// ─────────────────────────────── graph ───────────────────────────────
function initGraphControls() {
    document.querySelectorAll('.filter-btn').forEach(btn => btn.addEventListener('click', e => {
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
        currentFilter = e.currentTarget.dataset.filter;
        applyGraphFilter();
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
    const nodes = [];
    const nodeMap = new Map();
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
        const e = state.rel.get(c.chainId);
        if (!e) continue;
        if (e.l1Parent != null && ids.has(e.l1Parent) && nodeMap.has(c.chainId)) links.push({ source: c.chainId, target: e.l1Parent, kind: 'l2Of' });
        if (e.mainnet != null && ids.has(e.mainnet) && nodeMap.has(c.chainId)) links.push({ source: c.chainId, target: e.mainnet, kind: 'testnetOf' });
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
    if (currentFilter === 'all') {
        filteredData = { nodes: [...graphData.nodes], links: [...graphData.links] };
    } else {
        const set = new Set();
        for (const n of graphData.nodes) {
            if (n.type === currentFilter) {
                set.add(n.id);
                const e = state.rel.get(n.id);
                if (e?.l1Parent != null) set.add(e.l1Parent);
                if (e?.mainnet != null) set.add(e.mainnet);
            }
        }
        const nodes = graphData.nodes.filter(n => set.has(n.id));
        filteredData = { nodes, links: linksFor(set) };
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
    const dist = 150;
    const r = 1 + dist / Math.hypot(node.x, node.y, node.z);
    myGraph.cameraPosition({ x: node.x * r, y: node.y * r, z: node.z * r }, node, 1200);
}
function focusNodeById(id) {
    const n = filteredData.nodes.find(x => x.id === id) || graphData.nodes.find(x => x.id === id);
    if (n) focusNode(n);
}

// ─────────────────────────────── Chains view ───────────────────────────────
let chainSort = { key: 'chainId', dir: 1 };
let chainTagFilter = 'all';
const CHAIN_PAGE = 200;
let chainShown = CHAIN_PAGE;

function initChainsTableHeader() {
    document.querySelectorAll('#chainsTable thead th[data-sort]').forEach(th => {
        th.addEventListener('click', () => {
            const k = th.dataset.sort;
            chainSort.dir = chainSort.key === k ? -chainSort.dir : 1;
            chainSort.key = k;
            renderChainsView();
        });
    });
    document.querySelectorAll('#chainTagChips .chip').forEach(chip => chip.addEventListener('click', () => {
        document.querySelectorAll('#chainTagChips .chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        chainTagFilter = chip.dataset.tag;
        chainShown = CHAIN_PAGE;
        renderChainsView();
    }));
}

function chainRowData(c) {
    const e = state.rel.get(c.chainId);
    const rpcCount = (c.rpc || []).filter(u => { const url = typeof u === 'string' ? u : u?.url; return url && url.startsWith('http') && !url.includes('${'); }).length;
    return {
        chainId: c.chainId,
        name: c.name || `Chain ${c.chainId}`,
        tags: (c.tags || []).join(', '),
        native: c.nativeCurrency?.symbol || '',
        rpcs: rpcCount,
        tvs: state.l2beat.get(c.chainId)?.tvs ?? null,
        status: c.status || '',
        _l2: e?.l2Children.length || 0
    };
}

function renderChainsView() {
    const body = document.getElementById('chainsTableBody');
    if (!body) return;
    let rows = state.chains.filter(c => {
        if (chainTagFilter === 'all') return true;
        if (chainTagFilter === 'Mainnet') return classify(c) === 'Mainnet';
        return c.tags?.includes(chainTagFilter);
    }).map(chainRowData);

    const { key, dir } = chainSort;
    rows.sort((a, b) => {
        let av = a[key], bv = b[key];
        if (key === 'tvs') { av = av ?? -1; bv = bv ?? -1; }
        if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
        return String(av).localeCompare(String(bv)) * dir;
    });

    document.getElementById('chainsCount').textContent = `${rows.length.toLocaleString()} chains`;
    const slice = rows.slice(0, chainShown);
    body.textContent = '';
    for (const r of slice) {
        const tr = el('tr', { 'data-id': r.chainId, onclick: () => openChainDetail(r.chainId) }, [
            el('td', { class: 'num mono', text: String(r.chainId) }),
            el('td', {}, [el('span', { class: 'cell-name', text: r.name })]),
            el('td', {}, tagBadges(r.tags)),
            el('td', { class: 'mono muted', text: r.native || '—' }),
            el('td', { class: 'num', text: r.rpcs ? String(r.rpcs) : '—' }),
            el('td', { class: 'num', text: r.tvs != null ? fmtUsd(r.tvs) : '—' }),
            el('td', {}, [statusBadge(r.status)])
        ]);
        body.appendChild(tr);
    }
    const more = document.getElementById('chainsTableMore');
    more.textContent = '';
    if (rows.length > chainShown) {
        more.appendChild(el('button', { class: 'load-more', text: `Show more (${(rows.length - chainShown).toLocaleString()} remaining)`, onclick: () => { chainShown += CHAIN_PAGE * 2; renderChainsView(); } }));
    }
}

function tagBadges(tagStr) {
    if (!tagStr) return [el('span', { class: 'muted', text: '—' })];
    return tagStr.split(', ').map(t => el('span', { class: `tag tag-${t.toLowerCase()}`, text: t }));
}
function statusBadge(status) {
    if (!status) return el('span', { class: 'muted', text: '—' });
    return el('span', { class: `pill pill-${status.toLowerCase()}`, text: status });
}

// ─────────────────────────────── Scaling view ───────────────────────────────
let scalingSort = { key: 'tvs', dir: -1 };
function initScalingHeader() {
    document.querySelectorAll('#scalingTable thead th[data-sort]').forEach(th => th.addEventListener('click', () => {
        const k = th.dataset.sort;
        scalingSort.dir = scalingSort.key === k ? -scalingSort.dir : 1;
        scalingSort.key = k;
        renderScalingView();
    }));
}
function renderScalingView() {
    const body = document.getElementById('scalingTableBody');
    if (!body) return;
    const meta = document.getElementById('scalingMeta');
    if (state.l2beatMeta) meta.textContent = `${state.l2beatMeta.count} projects · ${state.l2beatMeta.source}`;

    const rows = [...state.l2beat.values()].map(p => ({
        tvs: p.tvs ?? null, name: p.displayName || p.slug, chainId: p.chainId,
        stage: p.stage || '', category: p.category || '', da: p.daLayer || '', stack: p.stack || ''
    }));
    const { key, dir } = scalingSort;
    rows.sort((a, b) => {
        let av = a[key], bv = b[key];
        if (key === 'tvs') { av = av ?? -1; bv = bv ?? -1; }
        if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
        return String(av).localeCompare(String(bv)) * dir;
    });
    body.textContent = '';
    for (const r of rows) {
        const tr = el('tr', { 'data-id': r.chainId, onclick: () => openChainDetail(r.chainId) }, [
            el('td', { class: 'num strong', text: fmtUsd(r.tvs) }),
            el('td', {}, [el('span', { class: 'cell-name', text: r.name })]),
            el('td', { class: 'num mono', text: String(r.chainId) }),
            el('td', {}, [el('span', { class: 'pill pill-stage', text: r.stage || '—' })]),
            el('td', { class: 'muted', text: r.category || '—' }),
            el('td', { class: 'muted', text: r.da || '—' }),
            el('td', { class: 'muted', text: r.stack || '—' })
        ]);
        body.appendChild(tr);
    }
}

// ─────────────────────────────── RPC & Status view ───────────────────────────────
function renderRpcStatCards(s) {
    const wrap = document.getElementById('rpcStatCards');
    if (!wrap || !s?.rpc) return;
    const cards = [
        { label: 'Endpoints tested', value: s.rpc.tested?.toLocaleString() ?? '—' },
        { label: 'Working', value: s.rpc.working?.toLocaleString() ?? '—', tone: 'good' },
        { label: 'Failed', value: s.rpc.failed?.toLocaleString() ?? '—', tone: 'bad' },
        { label: 'Health', value: s.rpc.healthPercent != null ? `${s.rpc.healthPercent}%` : '—' }
    ];
    wrap.textContent = '';
    for (const c of cards) {
        wrap.appendChild(el('div', { class: `stat-card ${c.tone || ''}` }, [
            el('div', { class: 'stat-value', text: c.value }),
            el('div', { class: 'stat-label', text: c.label })
        ]));
    }
}

async function loadStatusPages() {
    try {
        const d = await api('/status-pages');
        state.statusPages = d.statusPages || [];
        for (const sp of state.statusPages) for (const id of sp.chainIds || []) state.statusPagesByChain.set(id, { id: sp.id, name: sp.name, url: sp.url });
        renderStatusPageList('');
        const search = document.getElementById('statusPageSearch');
        search?.addEventListener('input', e => renderStatusPageList(e.target.value.toLowerCase().trim()));
    } catch { document.getElementById('statusPageList').textContent = 'Status pages unavailable.'; }
}

function renderStatusPageList(q) {
    const list = document.getElementById('statusPageList');
    if (!list) return;
    const items = state.statusPages.filter(sp => !q || sp.name.toLowerCase().includes(q) || sp.id.includes(q));
    list.textContent = '';
    for (const sp of items) {
        const host = safeHost(sp.url);
        list.appendChild(el('a', { class: 'status-page-row', href: sp.url, target: '_blank', rel: 'noopener' }, [
            el('span', { class: 'status-page-name', text: sp.name }),
            el('span', { class: 'status-page-host', text: host || sp.url })
        ]));
    }
    if (!items.length) list.appendChild(el('div', { class: 'feed-empty', text: 'No matching status pages.' }));
}

// Live status feed over WebSocket: chains-status-news streams `status.item`
// events and backfills recent ones via ?replay=N on connect. We dedupe by id
// and fall back to the REST /events endpoint only if the socket can't open.
const statusFeed = { items: [], seen: new Set(), ws: null, retries: 0, connected: false, restTried: false };

function feedItemNode(it) {
    const host = safeHost(it.url);
    const when = it.publishedAt || it.updatedAt || it.emittedAt;
    return el('a', { class: 'feed-item', href: it.url || '#', target: '_blank', rel: 'noopener' }, [
        el('div', { class: 'feed-title', text: it.title || '(untitled)' }),
        el('div', { class: 'feed-meta', text: [it.statusPage?.id || it.statusPage?.name, when ? new Date(when).toLocaleString() : null, host].filter(Boolean).join(' · ') })
    ]);
}

function renderStatusFeed() {
    const feed = document.getElementById('statusFeed');
    if (!feed) return;
    feed.textContent = '';
    if (!statusFeed.items.length) { feed.appendChild(el('div', { class: 'feed-empty', text: 'No recent status updates.' })); return; }
    for (const it of statusFeed.items.slice(0, 60)) feed.appendChild(feedItemNode(it));
}

function addStatusItems(items) {
    let added = false;
    for (const it of items) {
        const key = it.id || it.url || it.title;
        if (!key || statusFeed.seen.has(key)) continue;
        statusFeed.seen.add(key);
        statusFeed.items.push(it);
        added = true;
    }
    if (!added) return;
    statusFeed.items.sort((a, b) => new Date(b.publishedAt || b.updatedAt || b.emittedAt || 0) - new Date(a.publishedAt || a.updatedAt || a.emittedAt || 0));
    if (statusFeed.items.length > 200) statusFeed.items.length = 200;
    renderStatusFeed();
}

function connectStatusFeed() {
    const wsUrl = `${STATUS_NEWS_BASE.replace(/^http/, 'ws')}/ws?replay=40`;
    let ws;
    try { ws = new WebSocket(wsUrl); } catch { return statusFeedRestFallback(); }
    statusFeed.ws = ws;

    ws.onopen = () => { statusFeed.connected = true; statusFeed.retries = 0; };
    ws.onmessage = ev => {
        let m; try { m = JSON.parse(ev.data); } catch { return; }
        if (m.type === 'status.item' && m.item) addStatusItems([m.item]);
    };
    ws.onerror = () => { try { ws.close(); } catch { /* noop */ } };
    ws.onclose = () => {
        statusFeed.ws = null;
        // If we never got anything over WS, show REST results once so the panel isn't empty.
        if (!statusFeed.items.length && !statusFeed.restTried) statusFeedRestFallback();
        if (statusFeed.retries < 6) {
            const delay = Math.min(1000 * 2 ** statusFeed.retries, 20000);
            statusFeed.retries++;
            setTimeout(connectStatusFeed, delay);
        }
    };
}

async function statusFeedRestFallback() {
    statusFeed.restTried = true;
    try {
        const res = await fetch(`${STATUS_NEWS_BASE}/events?limit=40`, { headers: { accept: 'application/json' } });
        if (!res.ok) throw new Error(res.status);
        const d = await res.json();
        addStatusItems(d.events || d.items || []);
    } catch {
        if (!statusFeed.items.length) {
            const feed = document.getElementById('statusFeed');
            if (feed) { feed.textContent = ''; feed.appendChild(el('div', { class: 'feed-empty', text: 'Live status feed unavailable (chains-status-news).' })); }
        }
    }
}

// ─────────────────────────────── Detail drawer ───────────────────────────────
function initDrawer() {
    document.getElementById('closeDrawer')?.addEventListener('click', closeDrawer);
    document.getElementById('drawerScrim')?.addEventListener('click', closeDrawer);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDrawer(); });
}
function closeDrawer() { document.getElementById('detailDrawer')?.classList.add('hidden'); }

function chainLink(id) {
    const c = state.byId.get(id);
    return el('a', { class: 'chip-link', href: '#', text: c?.name || `Chain ${id}`, onclick: e => { e.preventDefault(); openChainDetail(id); } });
}

function detailRow(label, valueNode) {
    return el('div', { class: 'd-row' }, [el('span', { class: 'd-label', text: label }), el('div', { class: 'd-value' }, [].concat(valueNode))]);
}

function openChainDetail(chainId) {
    const c = state.byId.get(chainId);
    if (!c) return;
    const drawer = document.getElementById('detailDrawer');
    const body = document.getElementById('drawerBody');
    const type = classify(c);
    const e = state.rel.get(chainId) || {};
    const l2b = state.l2beat.get(chainId);
    const sp = state.statusPagesByChain.get(chainId);
    body.textContent = '';

    // header
    const icon = el('div', { class: 'd-icon', text: (c.name || '?').charAt(0).toUpperCase() });
    icon.style.background = `linear-gradient(135deg, ${COLORS[type]}, ${COLORS[type]}33)`;
    const badges = [el('span', { class: 'badge', text: `ID: ${c.chainId}` })];
    if (c.status) badges.push(statusBadge(c.status));
    (c.tags || []).forEach(t => badges.push(el('span', { class: `tag tag-${t.toLowerCase()}`, text: t })));
    body.appendChild(el('div', { class: 'd-header' }, [icon, el('div', {}, [
        el('h2', { text: c.name || `Chain ${c.chainId}` }),
        el('div', { class: 'd-badges' }, badges)
    ])]));

    const content = el('div', { class: 'd-content' });
    content.appendChild(detailRow('Native currency', el('span', { text: c.nativeCurrency ? `${c.nativeCurrency.name} (${c.nativeCurrency.symbol})` : '—' })));

    // relations
    if (e.l1Parent != null) content.appendChild(detailRow('L1 / parent', chainLink(e.l1Parent)));
    if (e.mainnet != null) content.appendChild(detailRow('Mainnet', chainLink(e.mainnet)));
    if (e.l2Children?.length) content.appendChild(detailRow(`L2 / L3 (${e.l2Children.length})`, e.l2Children.slice(0, 30).map(chainLink)));
    if (e.testnetChildren?.length) content.appendChild(detailRow(`Testnets (${e.testnetChildren.length})`, e.testnetChildren.slice(0, 30).map(chainLink)));

    // L2BEAT
    if (l2b) {
        content.appendChild(detailRow('L2BEAT', el('div', { class: 'l2b-grid' }, [
            el('span', { class: 'pill pill-stage', text: l2b.stage || '—' }),
            el('span', { class: 'muted', text: l2b.category || '' }),
            el('span', { class: 'strong', text: fmtUsd(l2b.tvs) }),
            l2b.daLayer ? el('span', { class: 'muted', text: `DA: ${l2b.daLayer}` }) : null
        ])));
    }

    // status page
    if (sp) {
        const host = safeHost(sp.url);
        content.appendChild(detailRow('Status page', el('a', { href: sp.url, target: '_blank', rel: 'noopener', text: host || sp.name })));
    }

    // explorers
    if (c.explorers?.length) {
        content.appendChild(detailRow('Explorers', c.explorers.map(x => el('a', { href: x.url, target: '_blank', rel: 'noopener', text: x.name || safeHost(x.url) }))));
    }
    // website
    if (c.infoURL) {
        const host = safeHost(c.infoURL);
        content.appendChild(detailRow('Website', host ? el('a', { href: c.infoURL, target: '_blank', rel: 'noopener', text: host }) : el('span', { text: c.infoURL })));
    }
    // slip44
    if (c.slip44 != null) content.appendChild(detailRow('SLIP-44', el('span', { class: 'mono', text: String(c.slip44) })));

    // RPC endpoints (static list) + live health placeholder
    const rpcBox = el('div', { class: 'd-rpc' }, [el('div', { class: 'd-rpc-loading', text: 'Checking RPC health…' })]);
    content.appendChild(detailRow('RPC endpoints', rpcBox));

    // clients placeholder
    const clientBox = el('div', { class: 'd-clients muted', text: '—' });
    content.appendChild(detailRow('Clients (live)', clientBox));

    body.appendChild(content);
    drawer.classList.remove('hidden');

    loadLiveRpc(chainId, rpcBox);
    loadLiveClients(chainId, clientBox);
}

async function loadLiveRpc(chainId, box) {
    const staticUrls = (state.byId.get(chainId)?.rpc || [])
        .map(u => typeof u === 'string' ? u : u?.url)
        .filter(u => u && u.startsWith('http') && !u.includes('${'));
    let results = [];
    try {
        const d = await api(`/rpc-monitor/${chainId}`);
        results = d.results || d.endpoints || (Array.isArray(d) ? d : []);
    } catch { /* fall back to static list */ }

    box.textContent = '';
    if (results.length) {
        for (const r of results.slice(0, 12)) {
            const ok = r.status === 'working' || r.ok === true;
            const host = safeHost(r.url) || r.url;
            const meta = [r.blockNumber || r.blockHeight ? `#${r.blockNumber ?? r.blockHeight}` : null, r.clientVersion ? String(r.clientVersion).split('/')[0] : null].filter(Boolean).join(' · ');
            box.appendChild(el('div', { class: 'rpc-row' }, [
                el('span', { class: `dot ${ok ? 'dot-ok' : 'dot-bad'}` }),
                el('span', { class: 'rpc-host mono', text: host }),
                el('span', { class: 'rpc-meta muted', text: meta })
            ]));
        }
    } else if (staticUrls.length) {
        for (const u of staticUrls.slice(0, 12)) box.appendChild(el('div', { class: 'rpc-row' }, [el('span', { class: 'dot' }), el('span', { class: 'rpc-host mono', text: safeHost(u) || u })]));
    } else {
        box.appendChild(el('span', { class: 'muted', text: 'No public endpoints.' }));
    }
}

async function loadLiveClients(chainId, box) {
    try {
        const d = await api(`/clients/${chainId}`);
        const clients = d.clients || [];
        if (!clients.length) { box.textContent = 'No client data yet.'; return; }
        box.textContent = '';
        box.classList.remove('muted');
        for (const cl of clients) {
            box.appendChild(el('span', { class: 'client-pill', text: `${cl.name}${cl.nodeCount ? ` ×${cl.nodeCount}` : ''}` }));
        }
    } catch { box.textContent = '—'; }
}

// init table headers once DOM is parsed (sections exist at load)
initChainsTableHeader();
initScalingHeader();
