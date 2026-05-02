# D:\CryptoTrader\src\cryptotrader\demo\__init__.py

"""
FaytSystems public read-only demo API package.

This package is intentionally separated from production/live gateways.
It exposes dashboard-safe GET/WebSocket endpoints only.

Public-safe boundary:
- read-only SQLite access
- no broker execution
- no take-profit controls
- no manual action queue
- no account/user auth
- no billing/webhook routes
- no POST/PUT/PATCH/DELETE routes
"""