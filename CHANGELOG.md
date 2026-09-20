# Changelog

All notable changes to the **iStore ERP** project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.1.114] - 2026-09-20

### Added
- Encrypted Cloudflare R2 database backups with tenant-separated object keys, remote size/checksum verification, retention, listing, download, and restore testing.
- Regression coverage for clean-install schema creation and historical Alembic upgrades.
- Windows system certificate-store support for secure R2 access through antivirus HTTPS inspection.

### Fixed
- Made SQLite restore replacement atomic, disposed live connections before cutover, and verified the restored database after replacement.
- Ensured pre-update and pre-restore backups use consistent SQLite snapshots and SHA-256 checksum sidecars.
- Corrected SQLite-incompatible historical migration operations and missing optional-table guards.
- Prevented runtime schema synchronization from silently bypassing Alembic unless explicitly enabled.
- Ensured local retention never keeps fewer generations than configured.

### Security
- Cloud uploads now require backup encryption.
- Cloud restore downloads must pass a non-destructive recovery test and enter the approval workflow before execution.

## [1.2.0] - 2026-08-17

### Added
- **WhatsApp Microservice & Bot Service**: Integrated standalone Node.js WhatsApp service for automated receipt dispatch, repair status notifications, customer inquiries, and daily financial summary broadcasts.
- **Cashier Shifts & Day End Summary**: Cash float management, drawer reconciliation, and automated daily shift closing reports.
- **Barcode & Sticker Printing**: Enhanced thermal barcode sticker generation and customizable label formats.
- **AI Sales & Inventory Assistant**: Integrated Google Gemini AI for inventory restocking recommendations and natural language store analytics.
- **Customer Public Portal Sync**: Real-time sync pipeline bridging desktop POS transactions to cloud customer tracking portal.
- **Comprehensive Documentation**: Added unified deployment guide, contributor guide, architecture specs, and security audit guides in `docs/`.

### Changed
- Refactored project directory structure and cleaned up loose build artifacts and search dumps.
- Enhanced `.gitignore` rules for Python, Electron, WhatsApp service, and local databases.
- Updated core `README.md` with complete architecture maps, screenshot galleries, and quickstart commands.

---

## [1.1.89] - 2026-08-07

### Added
- Auto-sync admin/manager/owner staff PIN hash to Supabase on POS PIN login.
- POS sync payload transmission for store logo and branch profile preferences.
- Offline outbox worker queue with SSL context handling for cloud synchronization.

### Fixed
- Window destruction safety handling prior to desktop `quitAndInstall`.
- Electron updater check null handling for up-to-date states.
- SQLite database connection timeout resilience during concurrent backup routines.

---

## [1.1.0] - 2026-06-15

### Added
- **Core POS Billing Module**: Barcode scanning, discount management, split payments (Cash, Card, Transfer), and invoice thermal receipt generation.
- **Inventory & Stock Management**: Stock tracking, low-stock threshold alerts, batch expiry management, and category categorization.
- **Repair Service Tracking**: Ticket creation, diagnostic notes, repair status workflow (Pending, In-Progress, Completed, Delivered), and technician assignment.
- **Warranty & Returns Module**: Warranty validation, serial number tracking, RMA handling, and customer refunds.
- **Cloud & Local Backup Engine**: Automated scheduled SQLite snapshots with encryption and optional Firebase/R2 cloud storage sync.
- **Role-Based Access Control (RBAC)**: Fine-grained permissions for Admin, Manager, Cashier, and Technician roles.
