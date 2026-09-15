# Data: 2026-09-14 corrections to the recon

These are the datasets behind the 2026-09-14 corrections in
[`../../robinhood-chain-recon.md`](../../robinhood-chain-recon.md): the third §3
correction (L1 pricing is bursty) and the revert-waste correction. Both were
collected on 2026-09-14, keylessly.

| File | Rows | What it is | Source |
| --- | ---: | --- | --- |
| `arbgasinfo-l1-estimate-hourly-2026-09-01_14.csv` | 324 | `ArbGasInfo.getL1BaseFeeEstimate()` and `getPricesInWei()` read from archive state every 35,640 blocks (~1 hour), 2026-08-31 23:18 to 2026-09-14 11:09 UTC | `robinhood.drpc.org`, `eth_call` at each block |
| `receipts-sampled-20min-2026-09-01_14.csv` | 962 | One block every 12,000 (~20 minutes). All its receipts, excluding the ArbOS internal transaction, summed to user tx count, gas used, L1 data gas (`gasUsedForL1`), reverted gas and reverted tx count | `rpc.mainnet.chain.robinhood.com` and `robinhood.drpc.org`, `eth_getBlockReceipts` |

Headline figures reproduce as:

- **L1 data gas:** `Σ l1_data_gas / Σ user_gas_used` is 0.182%. Excluding block
  60,322,000 (38.45% L1 in that block) it is 0.016%.
- **Revert waste:** `Σ reverted_gas / Σ user_gas_used` is 6.55%, and
  `Σ reverted_tx_count / Σ user_tx_count` is 13.94%.

These are samples, not a census. L1 pricing comes in short bursts, so one heavy
block moves the average a lot; the recon quotes it as "well under 1%" for that
reason. The incident dataset
([`../incident-2026-09-04/`](../incident-2026-09-04/)) shows where the bursts come
from: the ArbOS pricer catching up with expensive batches.
