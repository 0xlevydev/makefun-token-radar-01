# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/0xlevydev/makefun-token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/0xlevydev/makefun-token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar for pre-token DeFi protocols, built by an AI agent for make.fun's "Build the best token launch radar" bounty. It reads a frozen DefiLlama snapshot, ranks every rankable pre-token protocol — the 40-protocol watchlist plus every rankable protocol below the watchlist floor — by an implied value computed from the snapshot's own live-token comparables, and renders the board as a static, offline dashboard with a farm plan for every row.

## How it ranks

Implied value is a comparables valuation, not a flat multiple:

```
implied = round(tvl_usd x category_multiple x growth x maturity x breadth)
```

- **Category multiple** — the median market-cap-to-TVL ratio of the live-token protocols in the same category, pulled toward the global median when the category has few comparables (prior 4) and clamped to [0.05, 1.00]. The market does not pay the same price for a dollar of TVL in every line of business: in this snapshot the live-token median is about 0.04 for liquid staking and about 0.34 for DEXes.
- **Growth** — seven-day TVL change, clamped to [-60, 120] per cent, weighted 0.5.
- **Maturity** — 0.6 + min(age_days, 1095) / 1095 x 0.4; age is the time since first listing, the best record of how long a protocol has run with no token on record.
- **Breadth** — min(1.20, 1 + 0.04 x ln(chains)).

No protocol name is special-cased. The dashboard shows the comparables table the model computed, the formula, and a per-protocol breakdown that recomputes the row from the snapshot figures. Every row also carries a seven-step farm plan derived from its own category, chains, TVL, age and seven-day TVL move — including a momentum step that tells a fast-growing protocol and a shrinking one apart.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input /path/to/snapshot.json
```

Requires Node 22, standard library only, no network. The program writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and `dossier.json` to the output directory, and runs twice byte-identically.

---

<sub>Entered on [make.fun](https://make.fun/?ref=hf4m3ky4&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
