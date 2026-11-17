// Token Radar's dashboard, radar-2. It reads window.RADAR (written beside dashboard/ by main.ts)
// and renders the ranked board, a filterable table, a top-ten chart, the comparables table the
// model computed from, and a per-protocol detail drawer with the model's own inputs and the
// protocol's farm plan. No network: every byte it shows is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null, watchOnly: false };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return 'x' + n.toFixed(2);
  }

  // The model in one function: the page recomputes a row from the snapshot figures and checks the
  // number board.json carries, so the page's code and the board's data are visibly the same arithmetic.
  // implied = round(tvl x category_multiple x growth x maturity x breadth), each factor from the row.
  function impliedOf(row, model) {
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    var breadth = Math.min(model.breadth_cap, 1 + model.breadth_weight * Math.log(Math.max(1, (row.chains || []).length)));
    return Math.max(1, Math.round(row.tvl_usd * row.category_multiple * growthMult * maturity * breadth));
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // The farm plan is the same derivation main.ts writes to board.json: category, chains, TVL, age
  // and the seven-day TVL move decide the action, the capital, the hold and every cost and time.
  // No name is special-cased. The fourth step reads the protocol's own momentum, so a fast-growing
  // protocol and a shrinking one get different instructions.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function momentumText(p) {
    var g = p.change_7d;
    if (g === null || g === undefined) return 'No seven-day TVL change is recorded for this protocol, so size the position at the planned capital and re-check the trend weekly.';
    var pct = Math.abs(g).toFixed(1);
    if (g >= 20) return 'TVL is up ' + pct + '% in the last 7 days, so momentum is with this protocol: keep the position at full size and add a second tranche of the same capital after 14 days if TVL is still rising.';
    if (g <= -20) return 'TVL is down ' + pct + '% in the last 7 days, so keep the position at half the planned capital until the outflow stops, then re-check in 7 days.';
    if (g >= 0) return 'TVL is up ' + pct + '% in the last 7 days, so hold the position at the planned size and re-check the trend weekly.';
    return 'TVL is down ' + pct + '% in the last 7 days, so hold the position at the planned size and re-check the trend weekly.';
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('liquid staking') >= 0 || c.indexOf('liquid restaking') >= 0 || c.indexOf('staking pool') >= 0) return 'Stake $' + capital + " of the chain's staking asset through " + name + ' on ' + chain + ' and keep the receipt.';
    if (c.indexOf('restak') >= 0) return 'Restake $' + capital + ' of the liquid staking asset through ' + name + ' on ' + chain + ' and keep the receipt.';
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.';
    if (c.indexOf('dex') >= 0 || c.indexOf('leveraged farm') >= 0 || c.indexOf('liquidity manager') >= 0) return 'Provide $' + capital + " of liquidity to " + name + "'s main pool on " + chain + ' and keep the position open.';
    if (c.indexOf('yield aggregator') >= 0 || c.indexOf('yield') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('basis trading') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and place one market position on ' + name + '.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('risk') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
    if (c.indexOf('rwa') >= 0) return 'Mint $' + capital + " of the protocol's yield asset on " + chain + ' and hold it.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.';
    if (c.indexOf('launchpad') >= 0) return 'Join one ' + name + ' sale on ' + chain + ' with $' + capital + ' and keep the allocation receipt.';
    if (c.indexOf('farm') >= 0) return 'Deposit $' + capital + ' of USDC into ' + name + "'s farm on " + chain + ' and keep the position open.';
    if (c.indexOf('token locker') >= 0) return 'Lock $' + capital + ' of the paired asset through ' + name + ' on ' + chain + ' and keep the lock receipt.';
    if (c.indexOf('indexes') >= 0) return 'Buy $' + capital + ' of the ' + name + ' index on ' + chain + ' and hold the shares.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function gasFor(chain) {
    if (chain === 'Ethereum') {
      return { first: '$5–15 of gas for the first transaction', setup: 'about $5–15', weekly: '$5–15 of gas a week' };
    }
    return { first: 'under $1 of gas for the first transaction', setup: 'under $1', weekly: 'under $1 of gas a week' };
  }
  function weeklyFor(p) {
    var c = (p.category || '').toLowerCase();
    if (c.indexOf('liquid staking') >= 0 || c.indexOf('liquid restaking') >= 0 || c.indexOf('staking pool') >= 0) return 'Claim the staking rewards and restake them once a week.';
    if (c.indexOf('restak') >= 0) return 'Claim the restaking rewards and restake them once a week.';
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Borrow $10 against your supply once a week and repay it the same week.';
    if (c.indexOf('dex') >= 0 || c.indexOf('leveraged farm') >= 0 || c.indexOf('liquidity manager') >= 0) return 'Swap $10 through the main pool once a week.';
    if (c.indexOf('yield aggregator') >= 0 || c.indexOf('yield') >= 0) return 'Deposit another $10 into the vault once a week.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $10 to the chain and back once a week.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('basis trading') >= 0) return 'Open one small hedge once a week and close it the same week.';
    if (c.indexOf('prediction') >= 0) return 'Place one small market position once a week.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('risk') >= 0) return 'Deposit another $10 into the vault once a week.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit another $10 of the stable asset once a week.';
    if (c.indexOf('rwa') >= 0) return 'Buy another $10 of the yield asset once a week.';
    if (c.indexOf('insurance') >= 0) return 'Check the cover terms once a week and top the policy up by $10 if the price moved.';
    if (c.indexOf('launchpad') >= 0) return 'Check for a new sale once a week and join with $10 when one opens.';
    if (c.indexOf('farm') >= 0) return 'Deposit another $10 into the farm once a week.';
    if (c.indexOf('token locker') >= 0) return 'Lock another $10 of the paired asset once a week.';
    if (c.indexOf('indexes') >= 0) return 'Buy another $10 of the index once a week.';
    return 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.';
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var gas = gasFor(chain);
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: gas.first, time: '5 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and ' + gas.setup + ' of gas', time: '15 minutes to set up' },
      { text: weeklyFor(p), cost: gas.weekly, time: '10 minutes a week' },
      { text: momentumText(p), cost: 'no extra capital to check', time: '5 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' }
    ].map(stepText);
  }

  function isWatchlist(row) { return DATA.watchlist && DATA.watchlist.indexOf(row.slug) >= 0; }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('w') === '1') state.watchOnly = true;
    if (params.get('tab') === 'live') state.tab = 'live';
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.selected) params.set('p', state.selected);
    if (state.watchOnly) params.set('w', '1');
    if (state.tab === 'live') params.set('tab', 'live');
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.watchOnly && !isWatchlist(r)) return false;
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'multiple') { av = a.category_multiple; bv = b.category_multiple; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', null, 'Snapshot ', el('b', { text: DATA.as_of })),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', null, el('b', { text: DATA.model_version }), ' model')
      )
    );
  }

  function lede() {
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by implied value' }),
        el('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar ranks every rankable pre-token protocol below that floor, so the board covers ' + DATA.board_size + ' protocols instead of stopping at the floor. Implied value is a model, not a promise.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Early rows below the floor' }), el('b', { text: String(DATA.early_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(DATA.live_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Global comparable multiple' }), el('b', { text: fmtMult(DATA.comparables.global_median) })),
        el('div', { class: 'fact' }, el('span', { text: 'Categories with a trusted multiple' }), el('b', { text: DATA.comparables.categories.filter(function (c) { return c.comparables >= DATA.model.min_comparables; }).length + ' of ' + DATA.comparables.categories.length }))
      )
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var select = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    select.addEventListener('change', function () { state.category = select.value; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; render(); } });
    var watch = el('button', { type: 'button', class: 'toggle', 'aria-pressed': state.watchOnly ? 'true' : 'false', text: 'Watchlist only', onclick: function () { state.watchOnly = !state.watchOnly; writeHash(); render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), select),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      watch,
      el('span', { class: 'count', text: state.tab === 'pre-token' ? rows().length + ' rows shown' : DATA.live.length + ' live-token protocols' })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function topChart() {
    var top = DATA.rows.slice(0, 10);
    var max = top.length ? top[0].implied_value_usd : 1;
    var rowsEl = top.map(function (r) {
      return el('button', { type: 'button', class: 'chart-row', onclick: function () { openDetail(r.slug); } },
        el('span', { class: 'chart-rank', text: String(r.rank) }),
        el('span', { class: 'chart-name', text: r.name }),
        el('span', { class: 'chart-track', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(2, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
        el('span', { class: 'chart-val', text: fmtUsd(r.implied_value_usd) })
      );
    });
    return el('section', { class: 'panel chart' },
      el('div', { class: 'chart-head' },
        el('h2', { text: 'Top ten by implied value' }),
        el('span', { class: 'sub', text: 'Bars share the top row. Select a bar for its model and farm plan.' })
      ),
      el('div', { class: 'chart-rows' }, rowsEl)
    );
  }

  function modelPanel() {
    var m = DATA.model;
    var c = DATA.comparables;
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula' },
        'implied = round( tvl_usd x category_multiple x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ') x min(' + m.breadth_cap + ', 1 + ' + m.breadth_weight + ' x ln(chains)) )'
      ),
      el('p', null,
        el('b', { text: 'Category multiple. ' }),
        'The market does not pay the same price for a dollar of TVL in every line of business. For each category, the multiple is the median market-cap-to-TVL ratio of the live-token protocols in that category — ' + c.live_count + ' live comparables in this snapshot, global median ' + fmtMult(c.global_median) + ' — but two guards keep one noisy protocol from pricing a whole category. First, each ratio is capped at x' + m.ratio_cap.toFixed(2) + ' before the median: the live ratios in this snapshot run from x0.0003 to x400.20, and above x1.00 sits expectation, not TVL value. Second, a category median is trusted only when at least ' + m.min_comparables + ' live protocols trade in it; with fewer, the category uses the global median outright, in both directions. What is left is shrunk toward the global median (prior ' + m.category_prior + ') and clamped to [' + m.multiple_floor + ', ' + m.multiple_cap + '], so no single outlier prices a whole category. A category with no live comparables uses the global median.'
      ),
      el('p', null,
        el('b', { text: 'Growth, maturity, breadth. ' }),
        'Seven-day TVL growth is clamped to [' + m.growth_floor + ', ' + m.growth_cap + '] per cent and weighted ' + m.growth_weight + '. Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses ' + m.unknown_age_days + ' days. Breadth is the number of chains, logged, so a protocol on many chains counts for more than one on a single chain, but only a little.'
      ),
      el('p', { class: 'sub', text: 'The early radar is every rankable pre-token protocol below the watchlist floor, and the live-token protocols are set aside with their market caps shown. This is an estimate, not a price.' })
    );
  }

  function comparablesPanel() {
    var list = DATA.comparables.categories.slice().sort(function (a, b) { return b.multiple - a.multiple || (a.category < b.category ? -1 : 1); });
    var tbody = el('tbody');
    list.forEach(function (c) {
      var medianText = fmtMult(c.median_ratio);
      if (c.raw_median_ratio !== undefined && c.raw_median_ratio !== null && c.raw_median_ratio !== c.median_ratio) {
        medianText += ' (raw ' + fmtMult(c.raw_median_ratio) + ')';
      }
      tbody.appendChild(el('tr', null,
        el('td', null, el('b', { text: c.category })),
        el('td', { class: 'num', text: String(c.comparables) }),
        el('td', { class: 'num', text: medianText }),
        el('td', { class: 'num', text: fmtMult(c.multiple) })
      ));
    });
    return el('section', { class: 'panel comps' },
      el('h2', { text: 'What the market pays, by category' }),
      el('p', { class: 'sub', text: 'Live-token comparables from this snapshot: the median market-cap-to-TVL ratio per category, and the multiple the model applies. Each ratio is capped at x' + DATA.model.ratio_cap.toFixed(2) + ' before the median, and a category with fewer than ' + DATA.model.min_comparables + ' live comparables uses the global median of ' + fmtMult(DATA.comparables.global_median) + ' instead of its own. Where the raw median differs, it is shown in brackets.' }),
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'One row per category with at least one live-token protocol. Sorted by the multiple the model applies.' }),
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Category' }),
            el('th', { scope: 'col', text: 'Live comparables' }),
            el('th', { scope: 'col', text: 'Median ratio' }),
            el('th', { scope: 'col', text: 'Multiple applied' })
          )),
          tbody
        )
      )
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.watchOnly = false; writeHash(); render(); } })
      ));
    }
    var max = list[0].implied_value_usd || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var watch = isWatchlist(r);
      var lift = (r.tvl_rank === null || r.tvl_rank === undefined) ? null : r.tvl_rank - r.rank;
      var liftText = lift === null ? 'n/a' : lift === 0 ? '—' : (lift > 0 ? '▲' + lift : '▼' + (-lift));
      var liftClass = lift === null || lift === 0 ? '' : lift > 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        class: watch ? 'watch' : null,
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', { class: 'num lift ' + liftClass, text: liftText }),
        el('td', null, el('div', { class: 'name' },
          el('span', null, el('b', { text: r.name }), watch ? el('span', { class: 'tag', text: ' WATCH' }) : null),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', { class: 'num', text: fmtMult(r.category_multiple) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', null, el('span', { class: 'status', text: 'records no token' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan. A gold edge marks the watchlist. "vs TVL" is how far the model moved the row off the pure TVL order: up when its category, growth or age earned it a higher rank.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            el('th', { scope: 'col', text: 'vs TVL' }),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('multiple', 'Category x'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num', text: fmtMult(r.mcap_tvl_ratio) }),
        el('td', null, el('span', { class: 'status live', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking — and their market-cap-to-TVL ratios are the comparables the model prices the board with.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Mcap / TVL' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = farmSteps(row);
    var recomputed = impliedOf(row, DATA.model);
    var lift = (row.tvl_rank === null || row.tvl_rank === undefined) ? null : row.tvl_rank - row.rank;
    var liftText = lift === null ? 'n/a' : lift === 0 ? 'same as its TVL rank' : (lift > 0 ? '▲' + lift + ' places above its TVL rank' : '▼' + (-lift) + ' places below its TVL rank');
    var comp = null;
    if (DATA.comparables && DATA.comparables.categories) {
      for (var ci = 0; ci < DATA.comparables.categories.length; ci++) {
        if (DATA.comparables.categories[ci].category === row.category) { comp = DATA.comparables.categories[ci]; break; }
      }
    }
    var compText;
    if (!comp) {
      compText = (row.category || 'Other') + ' has no live-token comparables in this snapshot, so the model prices it at the global median ' + fmtMult(DATA.comparables.global_median) + '.';
    } else if (comp.comparables < DATA.model.min_comparables) {
      compText = (row.category || 'Other') + ' has only ' + comp.comparables + ' live comparable' + (comp.comparables === 1 ? '' : 's') + ', so the model does not trust its own median (raw ' + fmtMult(comp.raw_median_ratio) + ', capped ' + fmtMult(comp.median_ratio) + ') and uses the global median ' + fmtMult(DATA.comparables.global_median) + ' instead.';
    } else {
      compText = (row.category || 'Other') + ' has ' + comp.comparables + ' live comparables, median ratio ' + fmtMult(comp.median_ratio) + (comp.raw_median_ratio !== comp.median_ratio ? ' (raw ' + fmtMult(comp.raw_median_ratio) + ')' : '') + ', giving the multiple ' + fmtMult(row.category_multiple) + '.';
    }
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + (isWatchlist(row) ? ' — watchlist' : '') }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Category multiple (' + (row.category || 'Other') + ')' }), el('b', { class: 'num', text: fmtMult(row.category_multiple) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { class: 'num', text: fmtMult(row.growth_multiplier) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Maturity multiplier' }), el('b', { class: 'num', text: fmtMult(row.maturity_multiplier) })),
        el('div', null, el('span', { text: 'Chains (' + (row.chains || []).length + ')' }), el('b', { class: 'num', text: fmtMult(row.breadth_multiplier) })),
        el('div', null, el('span', { text: 'TVL rank' }), el('b', { class: 'num', text: row.tvl_rank === null || row.tvl_rank === undefined ? 'n/a' : String(row.tvl_rank) })),
        el('div', null, el('span', { text: 'Model lift' }), el('b', { class: 'num', text: liftText })),
        el('div', { class: 'total' }, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'sub', text: compText }),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + fmtUsd(recomputed) + (recomputed === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') {
      shell.appendChild(topChart());
      shell.appendChild(modelPanel());
      shell.appendChild(comparablesPanel());
    }
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
