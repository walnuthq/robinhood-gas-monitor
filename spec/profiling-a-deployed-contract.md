# Profiling a deployed contract from verified sources

`soldb profile` needs two things: a trace, and a debug artifact whose program
counters match the code that ran. For a contract you compiled yourself both come
for free. For a contract already deployed on a public chain — verified on a block
explorer, sitting behind a proxy, compiled years ago by a compiler that predates
ETHDebug — neither does.

This is a worked example of getting there anyway, on a real transaction. Every
number below was measured, and the decisive step is verifying that the recompiled
bytecode is the deployed bytecode: without that check the source lines a profile
prints are decoration.

The general mechanics of the command are in [profiling.md](profiling.md); this
document is about the artifact.

## The subject

| | |
| --- | --- |
| Transaction | `0x014364c99728029e692d69d9d1f4fd498a7cf8fdf407215de131d830ecdbdfd0` |
| Chain | Gnosis (100), block 48,125,949 |
| Entry contract | `0x33b41fe18d3a39046ad672f8a0c8c415454f629c` |
| Contract of interest | `GnosisControllerToken`, an ERC-20 behind an upgradeable proxy |
| Gas used | 96,052 across 3,368 steps |

The transaction does not call the token directly. It enters an unrelated contract
and reaches the token seven frames deep, through alternating calls and
delegatecalls.

## Step 1: find the code that actually runs

The address in the explorer URL is the proxy. A proxy's `DELEGATECALL` runs the
implementation's code, and the implementation is what a debug artifact describes,
so the artifact has to be keyed to the implementation address, not the proxy.

Read the EIP-1967 implementation slot:

```console
$ cast storage 0x420CA0f9B9b604cE0fd9C18EF134C705e5Fa3430 \
    0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc \
    --rpc-url https://rpc.gnosischain.com
0x00000000000000000000000060cb9fdd0fcfd9bb3b2b721864db5e7c07f4635d
```

The implementation is `0x60cb9fdd0fcfd9bb3b2b721864db5e7c07f4635d`. `soldb
list-contracts` agrees, and reports the proxy and the implementation as separate
entries, which is the shape the profiler keys on:

```console
$ soldb list-contracts 0x014364c9... --rpc-url https://rpc.gnosischain.com
...
Contract Address: 0x420ca0f9b9b604ce0fd9c18ef134c705e5fa3430
Contract Address: 0x60cb9fdd0fcfd9bb3b2b721864db5e7c07f4635d
...
```

Nine distinct addresses execute in this transaction.

## Step 2: get the verified sources and the exact settings

Reproducing bytecode needs more than the source text: it needs the compiler
version and every setting that changes codegen. Sourcify serves both, keylessly,
which the Etherscan V2 API no longer does (`Missing/Invalid API Key`):

```console
$ curl -s "https://sourcify.dev/server/v2/contract/100/0x60cb9fdd0fcfd9bb3b2b721864db5e7c07f4635d?fields=compilation,stdJsonInput,sources" -o impl.json
$ jq '.compilation.compilerVersion, .compilation.compilerSettings' impl.json
"0.8.20+commit.a1b79de6"
{ "viaIR": false, "optimizer": { "enabled": true, "runs": 200 }, "evmVersion": "paris", ... }
```

An `exact_match` on both creation and runtime bytecode. Write the 36 sources to
disk at the paths the input names, so the remappings resolve:

```console
$ jq -r '.sources | keys[]' impl.json | while read -r p; do
    mkdir -p "$(dirname "$p")"
    jq -r --arg p "$p" '.sources[$p].content' impl.json > "$p"
  done
```

## Step 3: reproduce the deployed bytecode

**This contract cannot use ETHDebug.** It was compiled with solc 0.8.20, which
predates ETHDebug entirely, and `soldb compile` emits ETHDebug by passing
`--via-ir`. Recompiling with a modern compiler produces different code, and a
debug artifact for different code maps program counters to the wrong lines.
Section [What ETHDebug does here](#what-ethdebug-does-here) shows exactly what
that costs.

The path that works is the legacy `srcmap` fallback, which SolDB accepts through
the same `--ethdebug-dir` flag. Legacy source maps carry exact PC-to-source
attribution; what they lack is variable locations and function identities.

Compile with the settings the verification reported, and nothing else:

```console
$ solc-select install 0.8.20
$ ~/.solc-select/artifacts/solc-0.8.20/solc-0.8.20 \
    --combined-json bin,bin-runtime,srcmap,srcmap-runtime,abi,storage-layout \
    --optimize --optimize-runs 200 --evm-version paris \
    --base-path . --include-path lib \
    @openzeppelin/contracts-upgradeable/=lib/openzeppelin-contracts-upgradeable/contracts/ \
    @openzeppelin/contracts/=lib/openzeppelin-contracts-upgradeable/lib/openzeppelin-contracts/contracts/ \
    src/GnosisControllerToken.sol > combined.json
```

`combined.json` must sit in the directory passed to `--ethdebug-dir`, and the
sources must be reachable from it. Compiling in the directory the sources were
written to satisfies both, so no `--source-path` is needed. The `--ethdebug-dir`
arguments below pass that directory as `.`, so run them from it.

### Verify it before trusting it

Compare the runtime code against the chain:

```console
$ cast code 0x60cb9fdd0fcfd9bb3b2b721864db5e7c07f4635d --rpc-url https://rpc.gnosischain.com
$ jq -r '.contracts["src/GnosisControllerToken.sol:GnosisControllerToken"]["bin-runtime"]' combined.json
```

Both are 16,630 bytes, and they differ in four regions totalling 92 bytes of
33,260 hex characters (0.5%):

```
byte   9880   20 bytes  deployed=60cb9fdd0fcfd9bb3b2b721864db5e7c07f4635d
byte   9921   20 bytes  deployed=60cb9fdd0fcfd9bb3b2b721864db5e7c07f4635d
byte  10242   20 bytes  deployed=60cb9fdd0fcfd9bb3b2b721864db5e7c07f4635d
byte  16587   32 bytes  deployed=0a08985b7ac3d70e30cb9b7c8aaabdc63d5a93cf1e8d…
```

The first three are the contract's own address, baked in as an immutable at deploy
time (`UUPSUpgradeable.__self`), which a fresh compile leaves zeroed. The last is
the trailing IPFS metadata hash, which covers source paths. The script under
[Reproducing this](#reproducing-this) prints exactly this.

No instruction differs and nothing shifts position, so **every program counter in
the deployed code means what the source map says it means.** That is the check
that makes the profile trustworthy; an artifact that fails it should be thrown
away, not adjusted.

## Step 4: run the profile

Backend choice is not incidental here — it decides whether the profile works at
all.

The `debug-rpc` backend returns opcodes and costs but no call identities. It sets
`capabilities.call_trace: false` and leaves `artifacts.calls` empty, and the
profiler attributes samples to a program by the frame's bytecode address. With no
frames, nothing below the entry contract can be attributed:

```console
$ soldb profile --backend debug-rpc --rpc https://rpc.gnosischain.com 0x014364c9... \
    --ethdebug-dir 0x60cb9fdd0fcfd9bb3b2b721864db5e7c07f4635d:GnosisControllerToken:.
Program-attributed gas: 0 (0.00%)
Unmapped execution gas: 1563287 (100.00%)
No execution steps matched a debug program
```

The artifact loaded correctly — this is purely the missing call tree. `profile`
defaults to `--backend replay` for this reason. Replay reads the parent-block
state over ordinary RPC and re-executes through REVM, recording frames as it goes:

```console
$ soldb profile --backend replay --rpc https://rpc.gnosischain.com 0x014364c9... \
    --ethdebug-dir 0x60cb9fdd0fcfd9bb3b2b721864db5e7c07f4635d:GnosisControllerToken:.
```

Both backends report 96,052 gas across 3,368 steps, so replay is reproducing the
node's execution, not approximating it. It took about 2m10s, nearly all of it
fetching state.

## The result

```
Program-attributed gas: 130089 (8.32%)
Source-attributed gas: 129341 (8.27%)
Unmapped execution gas: 1433198 (91.68%)

Contracts
      130089   8.32%      560  GnosisControllerToken (call)

Hot source lines
      114501   7.32%       70  src/GnosisControllerToken.sol:86  validator.validate(caller, to, amount),
        5090   0.33%       19  .../ERC20Upgradeable.sol:235  $._balances[to] += value;
        2993   0.19%       19  .../ERC20Upgradeable.sol:223  $._balances[from] = fromBalance - value;
        2178   0.14%       14  .../ERC20Upgradeable.sol:217  uint256 fromBalance = $._balances[from];
        2109   0.13%        4  src/GnosisControllerToken.sol:77  return _getControllerStorage().ticker;
        1805   0.12%       18  .../ERC20Upgradeable.sol:239  emit Transfer(from, to, value);
```

`--folded` shows how execution reaches the token:

```
contract 0x33b41fe1…
  CALL 0x33b41fe1…
    DELEGATECALL 0xda8151d9…
      CALL 0x4e53245b…
        DELEGATECALL 0x5cd822f1…
          CALL 0xcb444e90…
            CALL 0x420ca0f9…                                    (the proxy)
              DELEGATECALL GnosisControllerToken [0x60cb9fdd…]  (the implementation)
                src/GnosisControllerToken.sol:86   114501
```

### Reading the numbers

**8.32% is not a measurement failure.** Only one contract in this transaction has
a debug artifact; the other eight are unknown code, and their gas is honestly
reported as unmapped rather than folded into a neighbour. Supply artifacts for
more addresses and the attributed share rises.

**Gas is charged at the instruction.** Line 86's 114,501 gas is dominated by the
`CALL` that line performs — the cost of the callee, attributed to the call site.
That is why `DELEGATECALL` and `CALL` hold 57% and 40% of the opcode table. The
line is where the gas was spent from this contract's point of view, not where it
was burned.

**Functions are `<anonymous>`.** Legacy source maps carry no function identities,
so the function table is not useful here. Lines are exact; function names are the
thing ETHDebug would add.

## What ETHDebug does here

Two obstacles, both real.

The sources pin their compiler, so a modern solc refuses outright:

```
Error: Source file requires different compiler version (current compiler is 0.8.31)
 --> src/GnosisControllerToken.sol:1:1
1 | pragma solidity 0.8.20;
```

Relaxing the pragma to `^0.8.20` gets a compile — and a different contract. The
via-IR build is 26,444 bytes against the deployed 16,630. Feeding that artifact to
the same profile:

```
Program-attributed gas: 130089 (8.32%)
Source-attributed gas: 77 (0.00%)
Known program without source: 130012 (8.32%)

Functions
      130012   8.32%      539  GnosisControllerToken::<no source>
```

The frames still resolve, because those come from the trace. The program counters
resolve to nothing, because they describe other code. SolDB reports that as
`<no source>` rather than inventing a mapping — the 77 gas that did land is
coincidence, and the handful of lines it prints are noise.

**ETHDebug is available when you control the compile.** For a contract already
deployed by an older compiler, the legacy source map is not a downgrade to
tolerate; it is the only artifact that describes the code that actually ran.

## Reproducing this

```bash
TX=0x014364c99728029e692d69d9d1f4fd498a7cf8fdf407215de131d830ecdbdfd0
IMPL=0x60cb9fdd0fcfd9bb3b2b721864db5e7c07f4635d
RPC=https://rpc.gnosischain.com

curl -s "https://sourcify.dev/server/v2/contract/100/$IMPL?fields=compilation,sources" -o impl.json
mkdir work && cd work
jq -r '.sources | keys[]' ../impl.json | while read -r p; do
  mkdir -p "$(dirname "$p")"; jq -r --arg p "$p" '.sources[$p].content' ../impl.json > "$p"
done

solc-select install 0.8.20
~/.solc-select/artifacts/solc-0.8.20/solc-0.8.20 \
  --combined-json bin,bin-runtime,srcmap,srcmap-runtime,abi,storage-layout \
  --optimize --optimize-runs 200 --evm-version paris \
  --base-path . --include-path lib \
  @openzeppelin/contracts-upgradeable/=lib/openzeppelin-contracts-upgradeable/contracts/ \
  @openzeppelin/contracts/=lib/openzeppelin-contracts-upgradeable/lib/openzeppelin-contracts/contracts/ \
  src/GnosisControllerToken.sol > combined.json

# Confirm the recompile is the deployed code before trusting any line number.
# A plain diff always reports a difference — immutables are zero in a fresh
# compile — so report *where* the bytes differ and check each region is either an
# immutable or the trailing metadata hash.
cast code $IMPL --rpc-url $RPC | sed 's/^0x//' > deployed.hex
jq -r '.contracts["src/GnosisControllerToken.sol:GnosisControllerToken"]["bin-runtime"]' combined.json > compiled.hex
python3 - <<'PY'
d = open('deployed.hex').read().strip()
c = open('compiled.hex').read().strip()
assert len(d) == len(c), f"length differs: {len(d)} vs {len(c)} — not the same code"
regions, start = [], None
for i, (a, b) in enumerate(zip(d, c)):
    if a != b and start is None:
        start = i
    elif a == b and start is not None:
        regions.append((start, i)); start = None
if start is not None:
    regions.append((start, len(d)))
# Coalesce runs separated by a few coincidentally equal nibbles, so one immutable
# reads as one region.
merged = []
for s, e in regions:
    if merged and s - merged[-1][1] <= 8:
        merged[-1][1] = e
    else:
        merged.append([s, e])
for s, e in merged:
    print(f"byte {s // 2:>6}  {(e - s) // 2:>3} bytes  deployed={d[s:e][:44]}")
print(f"{sum(e - s for s, e in merged)} hex chars in {len(merged)} regions, of {len(d)}")
PY

soldb profile --backend replay --rpc $RPC $TX \
  --ethdebug-dir $IMPL:GnosisControllerToken:. \
  --flamegraph profile.svg
```

## Notes on the node

`https://rpc.gnosischain.com` answers `debug_traceTransaction` with full struct
logs, keylessly, including for old blocks — one of the few public endpoints that
does. It returns stack and storage but **no memory**, ignoring `enableMemory`.
That does not affect profiling, which needs program counters and gas, but it does
limit memory-resident variable decoding when tracing interactively.
