# D:\CryptoTrader\tools\sync_w_master_300_public_demo_decisions.py
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
SRC = PROJECT_ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from cryptotrader.demo.sig300_public import (  # noqa: E402
    get_public_sig300_decisions,
    sync_public_sig300_decisions,
)


def main() -> int:
    p = argparse.ArgumentParser(description="Sync private SIG300 live-runner audit rows into public demo mirror table.")
    p.add_argument("--audit-db", default=None)
    p.add_argument("--demo-db", default=None)
    p.add_argument("--json", action="store_true")
    args = p.parse_args()

    result = sync_public_sig300_decisions(audit_db_path=args.audit_db, demo_db_path=args.demo_db)
    rows = get_public_sig300_decisions(args.demo_db)
    payload = {**result, "decisions": rows}

    if args.json:
        print(json.dumps(payload, indent=2))
    else:
        print(f"Synced {payload.get('rows_synced', 0)} SIG300 public demo decisions")
        for r in rows:
            print(r)

    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
