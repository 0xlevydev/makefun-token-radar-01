// The token radar's model, radar-3: one frozen snapshot in, one ranked board out.
//
// The board ranks every pre-token protocol the snapshot carries that can be ranked below the
// watchlist floor — the watchlist first (the floor, never a ceiling), then every rankable
// protocol below it. A protocol is pre-token when its index entry records no token (no market
// cap, no CoinGecko id, no symbol); the snapshot's live-token protocols are kept apart and shown
// with the market's own values, never mixed into the ranked board.
//
// Implied value is a comparables valuation, computed only from the snapshot's own figures:
//
//   category multiple = a shrunk median of the live-token comparables in the same category.
//     For each category, take the live-token protocols (they already trade, so their market cap
//     is a fact) and their market-cap-to-TVL ratios. Two guards keep one noisy protocol from
//     pricing a whole category — and this snapshot needs both, because the raw ratios run from
//     0.0003 to 400.2:
//       1. each ratio is capped at 1.00 before the median: no category is priced above a dollar
//          of market cap per dollar of TVL. The 75th percentile of all live ratios is about
//          1.1, so 1.00 is where the market itself stops paying for TVL; above it sits
//          expectation, not TVL value. A single protocol at 400x (Rain, in Prediction Market)
//          or 12x (Collateral Management) therefore cannot set its category's price.
//       2. a category median is trusted only when at least 3 live protocols trade in it
//          (min_comparables). With fewer, the category uses the global median outright — in
//          both directions: it pulls an overpriced category down (Risk Curators, one
//          comparable at 2.97x) and an underpriced one up (Onchain Capital Allocator, two
//          comparables near 0.01x). With no reliable category signal, the market-wide median
//          is the honest estimate.
//     The trusted median is then pulled toward the global median when the category has few
//     comparables:
//       multiple = (n * median_category + K * median_global) / (n + K),  K = 4
//     then clamped to [0.05, 1.00] so no single outlier protocol can set a category's price.
//     Categories with no live comparables use the global median outright.
//   growth     = clamp(change_7d, -60, 120) per cent
//   growthMult = 1 + (growth / 100) * 0.5
//   maturity   = 0.6 + min(age_days, 1095) / 1095 * 0.4   (age_days unknown: 365)
//   breadth    = min(1.20, 1 + 0.04 * ln(chains))          (chains = number of chains, at least 1)
//   implied    = max(1, round(tvl_usd * category_multiple * growthMult * maturity * breadth))
//
// Why this beats a flat multiple: the market does not pay the same price for a dollar of TVL in
// every line of business. In this snapshot the live-token median ratio is about 0.04 for liquid
// staking and about 0.34 for DEXes, so a flat 0.25 overpays one and underpays the other. The
// shrinkage keeps small categories honest — a category with one live protocol does not inherit
// that protocol's ratio whole — and the clamp keeps the result inside what the market has ever
// paid for a dollar of TVL. No protocol name is ever special-cased: the same function scores
// every row, and the comparables table the dashboard shows is computed from this snapshot.
// The two guards are the difference from radar-2: under radar-2 a single live protocol at
// 2.97x priced all eight Risk Curators in the top twelve at x0.79, and a single protocol at
// 400x priced Prediction Market at the x1.00 cap. Under radar-3 both fall back to the global
// median, the top of the board spans six categories instead of four, and the largest implied
// value is about a fifth of its protocol's TVL instead of two thirds.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  category_prior: number;
  multiple_floor: number;
  multiple_cap: number;
  breadth_weight: number;
  breadth_cap: number;
  /** No single live ratio above this counts toward a category's median. */
  ratio_cap: number;
  /** A category median is trusted only with at least this many live comparables. */
  min_comparables: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  category_prior: 4,
  multiple_floor: 0.05,
  multiple_cap: 1.0,
  breadth_weight: 0.04,
  breadth_cap: 1.2,
  ratio_cap: 1.0,
  min_comparables: 3,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-3';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One category's comparables: what the live tokens in it trade at, and the multiple it gives. */
export interface CategoryComparable {
  category: string;
  comparables: number;
  /** The median ratio after the ratio cap: the number the multiple is computed from. */
  median_ratio: number;
  /** The median ratio before the cap, so the dashboard can show what the guard removed. */
  raw_median_ratio: number;
  multiple: number;
}

/** The comparables table the model computed from this snapshot. */
export interface Comparables {
  global_median: number;
  live_count: number;
  categories: CategoryComparable[];
}

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  /** The rank this protocol would hold on TVL alone: the model lift is rank minus tvl_rank. */
  tvl_rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    category_multiple: number;
    breadth_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
export interface RadarRow {
  rank: number;
  tvl_rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  category_multiple: number;
  breadth_multiplier: number;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  mcap_tvl_ratio: number | null;
}

/** Everything the dashboard needs: the board, the live set, the comparables and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist: string[];
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  comparables: Comparables;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The middle value of a sorted list, or the mean of the two middle values. */
export function medianOf(sorted: number[]): number {
  const n = sorted.length;
  if (n === 0) return 0;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/**
 * The comparables table: the live-token protocols' market-cap-to-TVL ratios, by category, and the
 * multiple each category gives a pre-token protocol. Ratios come from this snapshot only.
 *
 * Two guards, both motivated by this snapshot's own numbers. First, each ratio is capped at
 * ratio_cap (1.00) before the median: the live ratios run from 0.0003 to 400.2, and a single
 * protocol at 400x or 12x is expectation, not TVL value — without the cap it would set its
 * whole category's price. Second, a category median is trusted only with at least
 * min_comparables (3) live protocols; with fewer, the category uses the global median outright,
 * in both directions. A lone outlier therefore cannot price a whole category, and the shrinkage
 * toward the global median (prior K) only refines categories the market has actually spoken
 * about. The clamp keeps every multiple inside [0.05, 1.00].
 */
export function buildComparables(snapshot: Snapshot, model: ModelConstants = MODEL): Comparables {
  const byCategory = new Map<string, { capped: number[]; raw: number[] }>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (isPreToken(p) || p.category === 'CEX') continue;
    if (p.mcap_usd === null || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    if (!Number.isFinite(ratio) || ratio <= 0) continue;
    all.push(ratio);
    const list = byCategory.get(p.category!);
    if (list === undefined) byCategory.set(p.category!, { capped: [Math.min(model.ratio_cap, ratio)], raw: [ratio] });
    else {
      list.capped.push(Math.min(model.ratio_cap, ratio));
      list.raw.push(ratio);
    }
  }
  all.sort((a, b) => a - b);
  const globalMedian = medianOf(all);
  const categories: CategoryComparable[] = [];
  for (const [category, ratios] of byCategory) {
    ratios.capped.sort((a, b) => a - b);
    ratios.raw.sort((a, b) => a - b);
    const med = medianOf(ratios.capped);
    const rawMed = medianOf(ratios.raw);
    const trusted = ratios.capped.length >= model.min_comparables;
    const shrunk = trusted
      ? (ratios.capped.length * med + model.category_prior * globalMedian) / (ratios.capped.length + model.category_prior)
      : globalMedian;
    const multiple = Math.min(model.multiple_cap, Math.max(model.multiple_floor, shrunk));
    categories.push({ category, comparables: ratios.capped.length, median_ratio: round4(med), raw_median_ratio: round4(rawMed), multiple: round4(multiple) });
  }
  categories.sort((a, b) => (a.category < b.category ? -1 : a.category > b.category ? 1 : 0));
  return { global_median: round4(globalMedian), live_count: all.length, categories };
}

/** The multiple a category gives, from the comparables table; the global median when it has none. */
function multipleFor(category: string | null, comparables: Comparables): number {
  if (category === null) return comparables.global_median;
  const found = comparables.categories.find((c) => c.category === category);
  return found === undefined ? comparables.global_median : found.multiple;
}

export interface ImpliedBreakdown {
  implied: number;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  categoryMultiple: number;
  breadthMult: number;
  age: number | null;
}

/** The five multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  comparables: Comparables,
  model: ModelConstants = MODEL,
): ImpliedBreakdown {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult =
    model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const categoryMultiple = multipleFor(protocol.category, comparables);
  const chainCount = Math.max(1, protocol.chains.length);
  const breadthMult = Math.min(model.breadth_cap, 1 + model.breadth_weight * Math.log(chainCount));
  const implied = Math.max(
    1,
    Math.round(protocol.tvl_usd * categoryMultiple * growthMult * maturityMult * breadthMult),
  );
  return { implied, growthPct, growthMult, maturityMult, categoryMultiple, breadthMult, age };
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The headline sentence's figures: how many watchlist slugs, how many rows, how many live protocols. */
export interface BoardSummary {
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(
  snapshot: Snapshot,
  comparables: Comparables,
  model: ModelConstants = MODEL,
): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but
  // the board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every rankable pre-token protocol below the watchlist floor. The floor is
  // not arbitrary: above it, the snapshot's own watchlist is the universe, and the protocols it
  // leaves out are wrapped, staked or bridged products of tokens that already trade — WBTC,
  // staked ETH and the like — not launches waiting to happen. Below the floor, every rankable
  // protocol enters; the score decides the rank, not the TVL order.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, comparables, model);
    return { p, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  // The TVL rank: the same protocols ordered by TVL alone, so the dashboard can show how far
  // the model moved each row off the TVL order. Ties break by slug, as the board does.
  const byTvl = [...scored].sort((a, b) => b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  const tvlRank = new Map(byTvl.map((s, i) => [s.p.slug, i + 1]));
  return scored.map((s, i) => ({
    rank: i + 1,
    tvl_rank: tvlRank.get(s.p.slug)!,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      category_multiple: round4(s.categoryMultiple),
      breadth_multiplier: round4(s.breadthMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** A protocol's seven-day TVL move, in words, for the momentum step. */
function momentumText(p: SnapshotProtocol): string {
  const g = p.change_7d;
  if (g === null) return 'No seven-day TVL change is recorded for this protocol, so size the position at the planned capital and re-check the trend weekly.';
  const pct = Math.abs(g).toFixed(1);
  if (g >= 20) return `TVL is up ${pct}% in the last 7 days, so momentum is with this protocol: keep the position at full size and add a second tranche of the same capital after 14 days if TVL is still rising.`;
  if (g <= -20) return `TVL is down ${pct}% in the last 7 days, so keep the position at half the planned capital until the outflow stops, then re-check in 7 days.`;
  if (g >= 0) return `TVL is up ${pct}% in the last 7 days, so hold the position at the planned size and re-check the trend weekly.`;
  return `TVL is down ${pct}% in the last 7 days, so hold the position at the planned size and re-check the trend weekly.`;
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('liquid staking') || c.includes('liquid restaking') || c.includes('staking pool')) return `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and keep the receipt.`;
  if (c.includes('restak')) return `Restake $${capital} of the liquid staking asset through ${name} on ${chain} and keep the receipt.`;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('leveraged farm') || c.includes('liquidity manager')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('yield aggregator') || c.includes('yield')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('basis trading')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('risk')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  if (c.includes('launchpad')) return `Join one ${name} sale on ${chain} with $${capital} and keep the allocation receipt.`;
  if (c.includes('farm')) return `Deposit $${capital} of USDC into ${name}'s farm on ${chain} and keep the position open.`;
  if (c.includes('token locker')) return `Lock $${capital} of the paired asset through ${name} on ${chain} and keep the lock receipt.`;
  if (c.includes('indexes')) return `Buy $${capital} of the ${name} index on ${chain} and hold the shares.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** How much gas one transaction costs on a protocol's first chain: Ethereum mainnet is the
 * expensive outlier in this snapshot (424 protocols live there); every other chain the snapshot
 * names — Arbitrum, Base, Solana, Binance and the rest — settles a simple transaction for
 * under a dollar. The tiers are ranges, not quotes, and they come from the chain name only. */
export function gasFor(chain: string): { first: string; setup: string; weekly: string } {
  if (chain === 'Ethereum') {
    return { first: '$5–15 of gas for the first transaction', setup: 'about $5–15', weekly: '$5–15 of gas a week' };
  }
  return { first: 'under $1 of gas for the first transaction', setup: 'under $1', weekly: 'under $1 of gas a week' };
}

/** The category's weekly action: the same qualifying move every week, sized at $10, so the
 * farm plan names what to do instead of "a qualifying action". */
function weeklyFor(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('liquid staking') || c.includes('liquid restaking') || c.includes('staking pool')) return 'Claim the staking rewards and restake them once a week.';
  if (c.includes('restak')) return 'Claim the restaking rewards and restake them once a week.';
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return 'Borrow $10 against your supply once a week and repay it the same week.';
  if (c.includes('dex') || c.includes('leveraged farm') || c.includes('liquidity manager')) return 'Swap $10 through the main pool once a week.';
  if (c.includes('yield aggregator') || c.includes('yield')) return 'Deposit another $10 into the vault once a week.';
  if (c.includes('bridge')) return 'Bridge $10 to the chain and back once a week.';
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('basis trading')) return 'Open one small hedge once a week and close it the same week.';
  if (c.includes('prediction')) return 'Place one small market position once a week.';
  if (c.includes('curator') || c.includes('allocator') || c.includes('risk')) return 'Deposit another $10 into the vault once a week.';
  if (c.includes('stable')) return 'Mint or deposit another $10 of the stable asset once a week.';
  if (c.includes('rwa')) return 'Buy another $10 of the yield asset once a week.';
  if (c.includes('insurance')) return 'Check the cover terms once a week and top the policy up by $10 if the price moved.';
  if (c.includes('launchpad')) return 'Check for a new sale once a week and join with $10 when one opens.';
  if (c.includes('farm')) return 'Deposit another $10 into the farm once a week.';
  if (c.includes('token locker')) return 'Lock another $10 of the paired asset once a week.';
  if (c.includes('indexes')) return 'Buy another $10 of the index once a week.';
  return 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.';
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age, seven-day TVL move), never from a
 * hand-written list of names. The second step is the category's own action at a capital tier set
 * by TVL; the third step is the category's weekly action at $10, with gas priced by the first
 * chain; the fourth step reads the protocol's own momentum, so a fast-growing protocol and a
 * shrinking one get different instructions.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  const gas = gasFor(chain);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: gas.first,
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital and ${gas.setup} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: weeklyFor(p),
      cost: gas.weekly,
      time: '10 minutes a week',
    },
    {
      text: momentumText(p),
      cost: 'no extra capital to check',
      time: '5 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      mcap_tvl_ratio: p.tvl_usd > 0 && p.mcap_usd !== null ? round4(p.mcap_usd / p.tvl_usd) : null,
    }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    tvl_rank: row.tvl_rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    category_multiple: row.model.category_multiple,
    breadth_multiplier: row.model.breadth_multiplier,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(
  snapshot: Snapshot,
  model: ModelConstants = MODEL,
): { board: BoardRow[]; radar: RadarData } {
  const comparables = buildComparables(snapshot, model);
  const board = buildBoard(snapshot, comparables, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist: [...snapshot.watchlist],
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    comparables,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
