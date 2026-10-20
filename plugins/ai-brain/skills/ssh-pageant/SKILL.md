---
name: ssh-pageant
description: Use when a project needs SSH/SCP/SFTP, a remote shell command, a file copy to or from a server, or a server log read — connect through Pageant (PuTTY plink/pscp/psftp) with the user's .ppk key. NOT for cms-local / secureit-cms-site-manager / cms-mcp or SecureIT CMS (Forge) sites — those are guarded by ssh-guard and go through /sitemanager.
---

# SSH via Pageant (non-CMS projects)

Scope: the `ssh-guard` hook denies ssh-family calls inside the CMS folders by design. There use
`/sitemanager` (secureit-cms-site-manager artisan: `ssh:check`, `site:download-db`,
`site:pull-storage`, `site:pull-file`, `site:push-storage`). Everywhere else, use this skill.

## Facts (verified on this machine)
- `C:/Program Files/PuTTY/` holds plink.exe, pscp.exe, psftp.exe, pageant.exe, puttygen.exe.
- Git's OpenSSH `C:/Program Files/Git/usr/bin/ssh.exe` uses `~/.ssh/id_ed25519` (OpenSSH key), NOT Pageant.
- PuTTY key: `G:/My Drive/PuttyKeys/private.ppk` (Drive mirror: `C:/Users/lukar/Google Drive/PuttyKeys/private.ppk`). Use whichever exists.

## 1. Check the agent
```bash
tasklist //FI "IMAGENAME eq pageant.exe"
"C:/Program Files/PuTTY/plink.exe" -batch -agent -a -x -T -P <port> <user>@<host> true
```
- Exit 0 = Pageant holds an accepted key.
- "No supported authentication methods", "Server refused our key", "Access denied" = key not loaded or not authorized.
- Host key prompt/failure under `-batch` = host key not cached (see below).

## 2. Load the key (if missing)
Start Pageant detached with the .ppk:
```bash
powershell -NoProfile -Command "Start-Process 'C:/Program Files/PuTTY/pageant.exe' -ArgumentList '\"G:/My Drive/PuttyKeys/private.ppk\"'"
```
Tell the user to type the passphrase into the Pageant dialog (may be behind other windows).
Then poll the probe every ~3 s for up to ~90 s. Never ask for the passphrase in chat; never put
it on a command line.

## 3. Run commands
One-shot: `plink -batch -agent -T [-P port] user@host "cmd"`.
No interactive shells (the Bash tool has no TTY). Chain commands in one quoted string; quote carefully.

## 4. Copy files
- `pscp -batch -agent [-P port] [-r] src user@host:dst` (reverse: swap src/dst).
- Batch SFTP: `psftp -batch -agent [-P port] -b script.txt user@host`.

## Unknown host key
`-batch` refuses it. Ask the user to connect once with PuTTY (`putty.exe user@host`) to cache it,
or pass `-hostkey <fingerprint>` only with a fingerprint the user confirmed.
Never auto-accept or pipe "y".

## OpenSSH alternative
`ssh -o BatchMode=yes user@host "cmd"` with `~/.ssh/id_ed25519`, for hosts that trust that key.

## Safety
- Read-only commands are fine.
- Confirm with the user before state-changing remote actions: sudo, service restarts, deletes,
  config/.env edits, deploys.
- Never paste secrets or private keys into chat.
