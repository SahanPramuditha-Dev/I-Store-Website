# iStore Release Workflow

This guide explains how to use the automated release workflow for the iStore Electron desktop application.

## Overview

The repository includes a PowerShell release helper script: `release-istore.ps1`.
This script automates the GitHub release process for the Electron desktop app, including version updates, build steps, artifact validation, Git tagging, and GitHub Releases publishing.

## Prerequisites

Before running the release workflow, ensure the following are installed and configured:

- Git
- PowerShell (Windows PowerShell or PowerShell Core)
- Node.js and npm
- Python
- `gh` GitHub CLI
- `PyInstaller` installed in the selected Python environment
- A clean git working tree or use `-AutoCommit` to let the script commit version bumps

Also ensure the repository layout is intact:

- `frontend/` contains the React/Vite app
- `electron/` contains the Electron host and build configuration
- `backend/` contains the FastAPI backend
- `electron/scripts/update-version.ps1` exists and updates version numbers

## Script Location

- `release-istore.ps1`

## Usage

Run the release script from the repository root:

```powershell
.\release-istore.ps1 -Version 1.1.14
```

If you want the script to automatically commit the version bump changes, add the `-AutoCommit` switch:

```powershell
.\release-istore.ps1 -Version 1.1.14 -AutoCommit
```

To build artifacts without creating a GitHub Release, add `-SkipGitHub`:

```powershell
.\release-istore.ps1 -Version 1.1.14 -SkipGitHub
```

## What the script does

The release script performs these steps:

1. Validate required tools: `git`, `gh`, `npm`, `python`
2. Ensure the git working tree is clean
3. Update version numbers in:
   - `electron/package.json`
   - `frontend/package.json`
   - `electron/installer.iss`
4. Run backend tests using `python -m pytest -q`
5. Build the frontend using `npm run build`
6. Copy `frontend/dist` into `electron/frontend-dist`
7. Package the FastAPI backend with `PyInstaller`
8. Build the Electron NSIS installer using `npm run dist`
9. Validate release artifacts:
   - `.exe` installer
   - `latest.yml`
   - `.blockmap` files
   - backend bundle at `electron/backend-dist/IStoreBackend`
10. Compute SHA256 checksums for all release artifacts
11. Create a git tag named `v<version>`
12. Push commits and tags to `origin`
13. Create or update a GitHub Release with uploaded artifacts

## Expected Artifacts

After a successful run, the following files should exist in `dist-electron/`:

- `I-Store-ERP-Setup-<version>.exe`
- `latest.yml`
- `I-Store-ERP-Setup-<version>.exe.blockmap`
- other Electron builder artifacts

The backend bundle should exist at:

- `electron/backend-dist/IStoreBackend`

## GitHub Release Notes

The script generates release notes automatically using the git commit messages between the previous tag and the current commit.
It writes a markdown file named `release-notes-<version>.md` in the repository root.

## Troubleshooting

- If the script exits because the working tree is dirty, either commit or stash changes, or rerun with `-AutoCommit`.
- If `gh` is not found, install GitHub CLI and authenticate it with `gh auth login`.
- If `PyInstaller` is missing, install it into the Python environment used by the repo:

```powershell
python -m pip install pyinstaller
```

- If Electron dependencies are missing, install them in `electron/`:

```powershell
cd electron
npm ci
```

- If frontend dependencies are missing, install them in `frontend/`:

```powershell
cd frontend
npm ci
```

## Notes

- The script is built to reuse existing repository build commands and version update helpers.
- It is intended for Windows PowerShell and the current project structure.
- If you need code signing, configure Electron Builder and your certificate separately in `electron/package.json`.
