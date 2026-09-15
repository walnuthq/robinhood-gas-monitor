# Data: the 2026-09-04 Robinhood Chain incident

These are the datasets behind
[`../../robinhood-chain-2026-09-04-incident.md`](../../robinhood-chain-2026-09-04-incident.md).
All were collected from public, keyless endpoints on 2026-09-14, except the five
files marked as added on 2026-09-15, which were collected that day. Every number in
that document can be recomputed from these files; nothing needs chain access
again.

- **Times** are Unix seconds, with a `*_utc` ISO column alongside where it helps.
- **Amounts** are integers in wei unless the column name says otherwise.
- **Blocks and transactions** are identified by number and hash, so any row can be
  re-checked against the chain.

## Where the data came from

| Endpoint | Used for | Limits met |
| --- | --- | --- |
| `https://eth.drpc.org` | Ethereum logs, blocks, transactions, receipts, historical nonces | `eth_getLogs` ≤ 100 blocks per request; logs carry `blockTimestamp` |
| `https://rpc.mainnet.chain.robinhood.com` | Robinhood blocks, receipts, logs | `eth_getLogs` up to 50,000 blocks; 429s on parallel batches |
| `https://robinhood.drpc.org` | Robinhood traces and archive state (`eth_call` at old blocks) | JSON-RPC batches of 5+ return HTTP 500; `eth_getLogs` unusable past ~100 blocks |

Contract addresses:

- **SequencerInbox** on Ethereum: `0xBd0D173EEb87D57A09521c24388a12789F33ba96`
  (from [Robinhood's docs](https://docs.robinhood.com/chain/protocol-contracts/)).
- **Batch poster:** `0xdaa526086787d9debe1d7f3ffdb1fe50cf8687f4`, the only sender
  seen.
- **ArbGasInfo:** `0x…006c`.
- **ERC-4337 EntryPoint v0.8:** `0x4337084d9e255ff0702461cf8895ce9e3b5ff108`.

Decoders, so each file can be re-derived:

- **`SequencerBatchDelivered`**, topic
  `0x7394f4a19a13c7b92b5bb71033245305946ef78452f7b4986ac1390b5df4ebd7`. The batch
  sequence number is topic 1.
- **Batch calldata.** Both selectors seen, `addSequencerL2BatchFromBlobs`
  (`0x3e5aa082`) and `addSequencerL2BatchFromBlobsDelayProof` (`0x917cf8ac`), start
  `(sequenceNumber, afterDelayedMessagesRead, gasRefunder, prevMessageCount,
  newMessageCount)`. The newest L2 block in a batch is `newMessageCount − 1`.
- **Chainlink OCR2 `NewTransmission`**, topic
  `0xc797025feeeaf2cd924c99e9205acb8ec04d5cad21c41ce637a38fb6dee6016a`. Data words
  are `answer, transmitter, observationsTimestamp, …`. Inclusion delay is block
  timestamp minus `observationsTimestamp`.
- **`UserOperationEvent`**, topic
  `0x49628fd1471006c1482da88028e9ce4dbb080b815c9b0344d39e5a8e6ec1419f`. The account
  is topic 2; the nonce is the first data word.

## Ethereum (`ethereum/`)

| File | Rows | What it is | Spec |
| --- | ---: | --- | --- |
| `batch-deliveries-2026-09-01_14.csv` | 70,314 | Every `SequencerBatchDelivered` from 2026-09-01 00:00 to 2026-09-14 18:25 UTC. The sequence numbers have no gaps | §7 stall statistics, §8 "poster silent" |
| `batches-decoded-2026-09-04-1130_1430.csv` | 872 | Every batch from 11:30 to 14:30 on Sep 4, decoded: message counts, newest and oldest L2 block and their timestamps, posting delay, blob and execution gas price paid, receipt status | §7 poster table |
| `batches-decoded-2026-09-04-2008_2036.csv` | 145 | Every batch while the standing backlog drained, 20:08–20:36 | §7 "poster was already behind" |
| `batches-decoded-2026-09-11-1330_1430.csv` | 416 | Every batch around the Sep 11 control spike | §7 controls |
| `batch-posting-delay-sampled-20min-2026-09-01_14.csv` | 986 | One batch every ≥20 minutes across the fortnight, with the posting delay of its newest block | §7 standing backlog, §8 "poster headroom" |
| `batch-posting-delay-2026-09-04-1300_0100-every2min.csv` | 347 | One batch every ≥2 minutes, 13:00 Sep 4 to 01:00 Sep 5, used to find when the backlog cleared. Fee caps and nonce are filled for part of the range only | §7 |
| `batch-poster-nonce-2026-09-04.csv` | 13 | The poster's Ethereum nonce every 12 blocks from 12:20 to 12:49; frozen at 190,818 from 12:29:47 to 12:36:59 | §7 |
| `blocks-2026-09-04-1200_1330.csv` | 451 | Every Ethereum block 12:00–13:30: base fee, excess blob gas, blob gas used, gas utilisation | §7 trigger |
| `fees-around-posting-stalls-2026-09-01_14.csv` | 12 | Each batch gap of ≥180 s: Ethereum median base fee 15–5 min before, maximum during the gap, their ratio, utilisation and blobs per block during | §7 controls, §8 |

Added 2026-09-15, for the jobs-report trigger and the poster's bids:

| File | Rows | What it is | Spec |
| --- | ---: | --- | --- |
| `receipts-2026-09-04-1220_1250.csv` | 45,431 | Every Ethereum transaction in blocks 25,903,915–25,904,064 (12:20–12:50). Per row: sender, recipient, status, gas, effective gas price, priority fee per gas, blob gas, 4-byte selector, value, and counts of the Uniswap swaps, Aave v3 liquidations and Chainlink `AnswerUpdated` it emitted. Receipts sum to each header's `gasUsed` in all 150 blocks | §7 "What set off the spike" |
| `blocks-activity-2026-09-04-1220_1250.csv` | 150 | The same blocks, per block: builder tag, fee recipient, fullness, base fee, transactions and failures, swaps, Chainlink updates, liquidations, priority fees, proposer payment, blob transactions and blobs, Robinhood batches | §7 trigger table |
| `blob-txs-2026-09-04-1220_1250.csv` | 391 | Every blob transaction in those blocks: poster, inbox, blobs, priority fee per gas, and whether it is Robinhood's | §7 "Why the poster could not get in" |
| `batch-poster-fees-2026-09-01_14.csv` | 948 | Robinhood batch transactions with `maxPriorityFeePerGas`, `maxFeePerGas`, `maxFeePerBlobGas`, gas used, prices paid and the block base fee. `sample` is `sep4-window` (all, 12:00–13:30), `sep11-window` (all, 13:30–14:10) or `hourly` (first batch of each hour, Sep 1–14) | §7 poster bids |
| `batch-poster-tip-changes.csv` | 4 | The batches either side of the two tip-cap changes, found by bisection: 0.001 → 0.5 gwei at 20:06:47 on Sep 4, 0.5 → 0.25 gwei at 19:27:23 on Sep 8 | §7 "Robinhood raised the tip" |

More decoders for these files:

- **Uniswap `Swap`:** v2 `0xd78ad95f…9d822`, v3 `0xc42079f9…fbcca67`, v4 `0x40e9cecb…d7112f`.
- **Aave v3 `LiquidationCall`:** `0xe413a321…e005286`.
- **Chainlink `AnswerUpdated`:** `0x0559884f…46fc5f`.
- **Priority fee per gas** is `effectiveGasPrice − baseFeePerGas`.
- **Proposer payment** is the value of a block's last transaction when its sender is the block's fee recipient, as builders pay proposers.
- **OP Stack inboxes:** a batch inbox address is `0xff00…` followed by the chain ID. For example `…8453` is Base, `…0010` OP Mainnet, `…0130` Unichain and `…0480` World Chain.

## Robinhood Chain (`robinhood/`)

| File | Rows | What it is | Spec |
| --- | ---: | --- | --- |
| `chainlink-ocr2-transmissions-2026-09-04-1200_1400.csv` | 560 | Every OCR2 transmission 12:00–14:00 on Sep 4, with exact block timestamp, observation timestamp, delay, aggregator and transmitter | §7 write-path table |
| `chainlink-ocr2-transmissions-2026-09-03-1200_1400.csv` | 307 | Same, Sep 3 control | §7 controls |
| `chainlink-ocr2-transmissions-2026-09-11-1315_1445.csv` | 476 | Same, Sep 11 control | §7 controls |
| `chainlink-ocr2-transmissions-2026-09-01_14-interpolated.csv` | 12,339 | Every OCR2 transmission from 2026-08-31 23:02 to 2026-09-14 20:02 UTC, with exact observation timestamps and transmitters. Block timestamps are **interpolated** between anchors every 5,000 blocks (error of a few seconds, far below the 60 s re-broadcast steps); observation timestamps are exact | §7 fortnight statistics, §8 "write path" |
| `arbgasinfo-l1-pricing-2026-09-04-every2min.csv` | 52 | `getL1PricingSurplus`, `getL1PricingFundsDueForRewards`, `getL1PricingUnitsSinceUpdate`, `getLastL1PricingUpdateTime` and `perL1CalldataByte`, read from archive state every 1,200 blocks (~2 min), 11:59–13:43 | §7 pricer |
| `arbgasinfo-l1-estimate-2026-09-04-every1min.csv` | 71 | `getL1BaseFeeEstimate` and `getPricesInWei` every 600 blocks (~1 min), 12:29–13:40 | §5 L1 bursts and fee spike |
| `blocks-2026-09-04-1230_1340-every10.csv` | 4,201 | Every 10th block header: timestamp, gas used, tx count. **The tx count includes the ArbOS internal transaction** | §1, §2 |
| `blocks-2026-09-03-1215_1330-every30.csv`, `blocks-2026-09-05-1230_1340-every30.csv` | 1,401 / 1,381 | Every 30th block header, same clock window on the control days | §2 controls |
| `blocks-2026-09-03_05-every4000.csv` | 299 | One block every 4,000 from Sep 3 20:41 to Sep 5 06:10; every interval takes 400–408 s | §1 |
| `blocks-consecutive-2026-09-04.csv` | 28,718 | **Every** block in 12:46–12:56 and 13:24–13:30, plus 2-minute windows of consecutive blocks from 12:20 to 13:34 (the `window` column says which) | §7 "not a hard throttle", "not unhealthy block production" |
| `blocks-around-posting-stalls-every20.csv` | 11,140 | Every 20th block from 30 min before to 45 min after five long posting stalls, with user tx count | §7 controls (Sep 11 traffic) |
| `blocks-afternoon-2026-09-03-vs-04-every30.csv` | 16,632 | Every 30th block, 11:00–18:00, on Sep 3 and Sep 4 | §7 afternoon traffic |
| `receipts-2026-09-04-1230_1340-every30.csv` | 1,401 | Every 30th block's receipts, summed: user txs, gas, L1 data gas, reverted gas and txs. Superseded by the traces for the phase table, kept for the correction in §2 | §2 correction |
| `bundler-aa25-resubmissions.csv` | 115 | Failed EntryPoint v0.8 bundles: the resubmitted operation's account and nonce, where the operation first landed, and the gap | §4, §7 |
| `bundler-aa25-revert-reasons.csv` | 12 | Re-traced failed bundles and their decoded `FailedOp` reason, all `AA25 invalid account nonce` | §4 |

About the bundler samples (the `sample` column):

- **`series_2min_bins`** (51) is three random failed bundles per two-minute bin,
  12:36–13:10. It produces the §4 series.
- **`dip`, `after`, `partial`, `surge` and `wobble`** are random samples from those
  phases.
- All 115 carry full transaction hashes and were re-measured when saved. The 46
  whose hashes had been overwritten during analysis were recovered from their
  block, account and nonce, and each re-measured gap matched the original exactly.

## Traces (`traces/incident-sample.db`)

A SQLite extract, 26 MB, of the traced sample: every 10th block from 54,266,140 to
54,308,000 (12:30–13:40 UTC), collected with
`gasmon collect --exact-code`. The source database was 1.1 GB, almost all of it the
2.35M-row `frames` table, which is replaced here by a per-minute aggregate.

| Table | Rows | Content |
| --- | ---: | --- |
| `blocks` | 4,187 | gasmon's block table: timestamp, gas, control totals the conservation checks use |
| `txs` | 68,016 | Every transaction in those blocks: sender, recipient, type, status, receipt gas, L1 data gas, intrinsic gas (type `106` = ArbOS internal) |
| `code` | 22,207 | Address → code identity at the analysed block (none read at `latest`) |
| `verification` | 84 | Sourcify lookups for the top code identities (42 verified) |
| `gas_by_minute_code` | 46,406 | Self-gas, calls, reverted frames and code-deposit gas per UTC minute per code identity |
| `phases` | 7 | The phase boundaries used in the spec |
| `code_verification` (view) | — | Verification lifted from address to code identity |

Every phase table, sender segment, placebo and entry-contract ratio in §2–§3 is a
`GROUP BY` over `txs` joined to `phases` and `code`. The gas-level view in §3 uses
`gas_by_minute_code`.

## Caveats

- **Sampling.** The traces are every 10th block, and some header and receipt files
  are every 30th. Rates per sampled block are unbiased; totals are not.
- **Random samples.** The bundler files are random samples, as the spec says. A
  fresh draw gives different individual rows and similar medians.
- **Interpolated timestamps** in the fortnight Chainlink file; see above.
- **Nitro source.** The throttle behaviour cited in §7 is from
  `execution/gethexec/sequencer.go` on Nitro's `master` branch as of 2026-09-14,
  not necessarily the version Robinhood runs.
- **Scripts.** The ad hoc collection scripts were not kept. Every file here is
  described well enough to re-collect it, and the planned `gasmon` health
  collector will replace them.
- **A decoding fix applied before saving.** An early version read the OCR2
  transmitter from the wrong data word. The transmitter columns here are correct,
  and the spec's transmitter count was corrected.
