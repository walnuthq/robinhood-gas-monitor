"""Command-line interface.

  gasmon collect --last 200     trace blocks into the database
  gasmon verify                 run the identity checks
  gasmon sources                resolve Sourcify verification
  gasmon top                    rank code by self-gas
  gasmon diff --a … --b …       compare two block ranges
"""

import argparse
import sys

from .collect import cmd_collect
from .report import cmd_diff, cmd_top, cmd_verify
from .rpc import RPC_DEFAULT, TRACE_DEFAULT
from .sources import cmd_sources

DESCRIPTION = """\
gasmon - per-block gas attribution for Robinhood Chain, and any Nitro/EVM chain
whose RPC serves debug_traceBlockByNumber with callTracer.

Closes the block gas identity and materialises a frame table. Everything
downstream - ranking, hourly aggregation, spike-vs-baseline diffs - is grouping
over frames, so the frame row has to be right before anything else is worth
computing. See spec/robinhood-chain-recon.md.
"""


def build_parser():
    # Shared options, accepted either side of the subcommand.
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--db", default="gas.db")
    common.add_argument("--rpc", default=RPC_DEFAULT,
                        help="endpoint for eth_* (default: %(default)s)")
    common.add_argument("--trace-rpc", default=TRACE_DEFAULT,
                        help="endpoint for debug_* and historical state (default: %(default)s)")

    p = argparse.ArgumentParser(prog="gasmon", description=DESCRIPTION, parents=[common],
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)

    c = sub.add_parser("collect", parents=[common], help="trace blocks into the database")
    c.add_argument("--last", type=int, help="collect the last N blocks behind head")
    c.add_argument("--from-block", type=int)
    c.add_argument("--to-block", type=int)
    c.add_argument("--stride", type=int, default=1, help="sample every Nth block")
    c.add_argument("--workers", type=int, default=4)
    c.set_defaults(func=cmd_collect)

    v = sub.add_parser("verify", parents=[common], help="run the identity checks")
    v.set_defaults(func=cmd_verify)

    sc = sub.add_parser("sources", parents=[common],
                        help="resolve Sourcify verification for the top code identities")
    sc.add_argument("--limit", type=int, default=200, help="how many code identities, by gas")
    sc.add_argument("--per-group", type=int, default=3,
                    help="addresses to try per code identity before giving up")
    sc.add_argument("--chain-id", type=int, default=4663)
    sc.add_argument("--recheck-days", type=int, default=7,
                    help="re-query addresses last seen unverified this long ago")
    sc.add_argument("--delay", type=float, default=0.15)
    sc.set_defaults(func=cmd_sources)

    t = sub.add_parser("top", parents=[common], help="rank code by self-gas")
    t.add_argument("--limit", type=int, default=20)
    t.add_argument("--range", help="LO-HI block range (default: everything)")
    t.set_defaults(func=cmd_top)

    d = sub.add_parser("diff", parents=[common],
                       help="compare two block ranges, normalised per transaction")
    d.add_argument("--a", required=True, help="baseline range LO-HI")
    d.add_argument("--b", required=True, help="comparison range LO-HI")
    d.add_argument("--limit", type=int, default=25)
    d.set_defaults(func=cmd_diff)
    return p


def main(argv=None):
    sys.setrecursionlimit(20000)  # deep Nitro call trees
    p = build_parser()
    args = p.parse_args(argv)
    if args.cmd == "collect" and not args.last and not (args.from_block and args.to_block):
        p.error("collect needs --last N or --from-block/--to-block")
    try:
        args.func(args)
    except KeyboardInterrupt:
        return 130
    return 0


if __name__ == "__main__":
    sys.exit(main())
