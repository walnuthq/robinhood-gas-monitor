"""Schema and connection.

Three grains, deliberately kept apart:

  frames  - one row per EVM execution context. The measurement.
  txs     - one row per transaction. Holds the non-execution terms (intrinsic,
            L1 data gas, refunds) that must not be charged to a contract.
  blocks  - one row per block, with the control totals the checks run against.

Plus two identity tables. `code` maps an address to the code it ran, at the block
it ran there. `verification` records what a registry says about an ADDRESS,
because that is the only grain Sourcify can be asked about; the
`code_verification` view lifts that to CODE, which is what the fact is really
about.
"""

import sqlite3

SCHEMA = """
CREATE TABLE IF NOT EXISTS blocks (
  number INTEGER PRIMARY KEY, timestamp INTEGER, base_fee INTEGER,
  gas_used INTEGER, tx_count INTEGER,
  sum_receipt_gas INTEGER, sum_root_gas INTEGER, sum_self_raw INTEGER,
  sum_intrinsic INTEGER, neg_self_frames INTEGER, neg_root_residual INTEGER,
  collected_at INTEGER
);
CREATE TABLE IF NOT EXISTS txs (
  hash TEXT PRIMARY KEY, block INTEGER, idx INTEGER, type INTEGER,
  sender TEXT, recipient TEXT, status INTEGER, receipt_gas INTEGER,
  gas_used_for_l1 INTEGER, gas_price INTEGER, calldata_len INTEGER,
  intrinsic INTEGER, intrinsic_standard INTEGER, root_residual INTEGER,
  refund_lb INTEGER
);
CREATE TABLE IF NOT EXISTS frames (
  block INTEGER, tx_hash TEXT, idx INTEGER, depth INTEGER, parent INTEGER,
  type TEXT, caller TEXT, addr TEXT, code_id TEXT,
  gas_used INTEGER, self_gas_raw INTEGER, self_gas INTEGER,
  selector TEXT, reverted INTEGER, code_len INTEGER, deposit_gas INTEGER,
  is_precompile INTEGER, is_root INTEGER,
  PRIMARY KEY (tx_hash, idx)
);
CREATE TABLE IF NOT EXISTS code (
  addr TEXT PRIMARY KEY, code_id TEXT, code_len INTEGER, block_read INTEGER,
  delegate TEXT               -- EIP-7702: the implementation a 23-byte designator points at
);
-- Verification is recorded at ADDRESS grain, because that is the only grain
-- Sourcify (and Blockscout) can be asked about. One row per (address, source)
-- so several registries can disagree without overwriting each other, and so a
-- negative answer is cached rather than re-queried every run.
CREATE TABLE IF NOT EXISTS verification (
  addr TEXT NOT NULL, source TEXT NOT NULL,
  status TEXT NOT NULL,        -- verified | none | error
  match_type TEXT,             -- exact_match | match
  name TEXT, compiler TEXT, settings TEXT, verified_at TEXT,
  checked_at INTEGER NOT NULL,
  PRIMARY KEY (addr, source)
);
CREATE INDEX IF NOT EXISTS ix_frames_block ON frames(block);
CREATE INDEX IF NOT EXISTS ix_frames_code ON frames(code_id);
CREATE INDEX IF NOT EXISTS ix_frames_addr ON frames(addr);
CREATE INDEX IF NOT EXISTS ix_txs_block ON txs(block);
CREATE INDEX IF NOT EXISTS ix_code_codeid ON code(code_id);

-- Verification is a property of CODE, not of an address: byte-identical runtime
-- code has byte-identical sources, immutables and metadata hash included. So one
-- verified address proves the whole code_id group, and this view does the
-- propagation. `OR v.addr = c.delegate` covers EIP-7702 designators, where the
-- code that runs lives at the delegate, not at the account we traced.
CREATE VIEW IF NOT EXISTS code_verification AS
SELECT c.code_id AS code_id,
       MAX(CASE WHEN v.status = 'verified' THEN 1 ELSE 0 END) AS verified,
       COUNT(DISTINCT c.addr)                                 AS addrs,
       COUNT(DISTINCT v.addr)                                 AS checked_addrs,
       MIN(CASE WHEN v.status = 'verified' THEN v.addr END)       AS proof_addr,
       MIN(CASE WHEN v.status = 'verified' THEN v.name END)       AS name,
       MIN(CASE WHEN v.status = 'verified' THEN v.match_type END) AS match_type,
       MIN(CASE WHEN v.status = 'verified' THEN v.compiler END)   AS compiler,
       MIN(CASE WHEN v.status = 'verified' THEN v.settings END)   AS settings
FROM code c LEFT JOIN verification v ON v.addr = c.addr OR v.addr = c.delegate
GROUP BY c.code_id;
"""


def db_open(path):
    con = sqlite3.connect(path, timeout=60)
    try:  # migrate databases created before the delegate column existed
        con.execute("ALTER TABLE code ADD COLUMN delegate TEXT")
    except sqlite3.OperationalError:
        pass
    con.executescript(SCHEMA)
    return con
