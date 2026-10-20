#!/usr/bin/env node
'use strict';
/*
 * Fixture tests for ssh-guard.js. Run: node ssh-guard.test.js
 * Each case pipes PreToolUse JSON to the hook and checks deny vs silent.
 * Silent = exit 0 and empty stdout.
 */

const assert = require('node:assert');
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const HOOK = path.join(__dirname, 'ssh-guard.js');

function run(toolName, toolInput, cwd) {
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: toolName, tool_input: toolInput, cwd: cwd }),
    encoding: 'utf8',
  });
  assert.strictEqual(r.status, 0, 'hook must always exit 0');
  return r.stdout.trim();
}

function denied(out) {
  return out !== '' && JSON.parse(out).hookSpecificOutput.permissionDecision === 'deny';
}

const SM = 'C:/laragon/www/secureit-cms-site-manager';
const OTHER = 'C:/laragon/www/frameshift';

// Throwaway repos outside CMS_ROOTS: a CMS clone, a worktree of it, and an unrelated repo.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ssh-guard-'));
function repo(name, url) {
  fs.mkdirSync(path.join(TMP, name, '.git'), { recursive: true });
  fs.mkdirSync(path.join(TMP, name, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(TMP, name, '.git', 'config'), '[remote "origin"]\r\n\turl = ' + url + '\r\n');
  return path.join(TMP, name);
}
const CLONE = repo('cms-clone', 'https://github.com/SecureIT-Swiss/cms.git');
const UNRELATED = repo('other', 'https://github.com/SecureIT-Swiss/cms-theme-tools.git');
const WT = path.join(TMP, 'wt');
fs.mkdirSync(path.join(CLONE, '.git', 'worktrees', 'wt'), { recursive: true });
fs.writeFileSync(path.join(CLONE, '.git', 'worktrees', 'wt', 'commondir'), '../..\n');
fs.mkdirSync(WT);
fs.writeFileSync(path.join(WT, '.git'), 'gitdir: ' + path.join(CLONE, '.git', 'worktrees', 'wt') + '\n');
const cases = [
  // Rule a — direct client calls
  ['blocks plink', 'Bash', { command: 'plink -batch forge-host "ls"' }, true],
  ['blocks full-path plink (quoted)', 'Bash', { command: '"C:\\Program Files\\PuTTY\\plink.exe" -batch host ls' }, true],
  ['blocks posix full-path plink', 'Bash', { command: '"/c/Program Files/PuTTY/plink.exe" -V' }, true],
  ['blocks ssh after &&', 'Bash', { command: 'cd /tmp && ssh host uptime' }, true],
  ['blocks scp', 'Bash', { command: 'scp -r a host:/b' }, true],
  ['blocks pscp in PowerShell call', 'PowerShell', { command: '& "C:\\Program Files\\PuTTY\\pscp.exe" a b' }, true],
  ['blocks rsync', 'Bash', { command: 'rsync -av a/ host:b/' }, true],
  ['blocks winscp.com', 'PowerShell', { command: 'winscp.com /script=x.txt' }, true],
  ['blocks php -r exec plink', 'Bash', { command: 'php -r "exec(\'plink host ls\');"' }, true],
  // Rule b — indirect routes
  ['blocks forge@ in git', 'Bash', { command: 'git clone forge@1.2.3.4:repo.git' }, true],
  ['blocks tinker exec to forge@', 'Bash', { command: 'php artisan tinker --execute="exec(\'x forge@1.2.3.4\')"' }, true],
  ['blocks GIT_SSH_COMMAND', 'Bash', { command: 'GIT_SSH_COMMAND="x" git fetch' }, true],
  ['blocks core.sshCommand', 'Bash', { command: 'git -c core.sshCommand=x fetch' }, true],
  ['blocks Enter-PSSession', 'PowerShell', { command: 'Enter-PSSession -HostName x' }, true],
  // Allowed commands
  ['allows artisan ssh:check', 'Bash', { command: 'php artisan ssh:check bck.secureit.ch' }, false],
  ['allows --via=ssh', 'Bash', { command: 'php artisan site:download-db bck --via=ssh --dump-only' }, false],
  ['allows ssh-keygen -l', 'Bash', { command: 'ssh-keygen -l -f key.pub' }, false],
  ['allows ~/.ssh path', 'Bash', { command: 'ls ~/.ssh/' }, false],
  ['allows git push https', 'Bash', { command: 'git push origin main' }, false],
  ['allows plain npm', 'PowerShell', { command: 'npm run build' }, false],
  // Rule c — content
  ['blocks plink in a random php file', 'Write', { file_path: SM + '/app/Console/Commands/Foo.php', content: '$p = "plink";' }, true],
  ['blocks forge@ via Edit', 'Edit', { file_path: SM + '/app/Foo.php', old_string: 'a', new_string: 'forge@host' }, true],
  ['blocks pscp via MultiEdit', 'MultiEdit', { file_path: SM + '/app/Foo.php', edits: [{ old_string: 'a', new_string: 'pscp' }] }, true],
  ['allows ReadOnlySshService', 'Write', { file_path: SM + '\\app\\Services\\ReadOnlySshService.php', content: 'plink pscp psftp' }, false],
  ['allows config/ssh.php', 'Write', { file_path: SM + '/config/ssh.php', content: "'plink' => 'C:/Program Files/PuTTY/plink.exe'" }, false],
  ['allows tests', 'Write', { file_path: SM + '/tests/Unit/ReadOnlySshServiceTest.php', content: 'plink' }, false],
  ['allows markdown', 'Write', { file_path: SM + '/.claude/skills/site-pull/SKILL.md', content: 'never call plink directly' }, false],
  ['allows settings deny rules', 'Edit', { file_path: 'C:/Users/x/.claude/settings.json', old_string: 'a', new_string: 'Bash(plink:*)' }, false],
  ['allows unrelated write', 'Write', { file_path: SM + '/app/Foo.php', content: '<?php echo 1;' }, false],
  // Scope — CMS folders and clones are guarded, everything else is not
  ['blocks plink in posix cms-local cwd', 'Bash', { command: 'plink -batch host ls' }, true, '/c/laragon/www/cms-local'],
  ['blocks ssh in cms-local worktree', 'Bash', { command: 'ssh host uptime' }, true, 'C:\\laragon\\www\\cms-local\\.claude\\worktrees\\x'],
  ['blocks ssh in cms-mcp', 'Bash', { command: 'ssh host uptime' }, true, 'C:/laragon/www/cms-mcp'],
  ['blocks cd into cms-local from elsewhere', 'Bash', { command: 'cd C:/laragon/www/cms-local && plink host ls' }, true, OTHER],
  ['blocks posix cd into site manager from elsewhere', 'Bash', { command: 'cd /c/laragon/www/secureit-cms-site-manager; scp a host:b' }, true, OTHER],
  ['blocks ssh in a CMS clone (remote match)', 'Bash', { command: 'ssh host uptime' }, true, path.join(CLONE, 'sub')],
  ['blocks ssh in a worktree of a CMS clone', 'Bash', { command: 'ssh host uptime' }, true, WT],
  ['blocks plink write into cms-local from elsewhere', 'Write', { file_path: 'C:/laragon/www/cms-local/app/Foo.php', content: 'plink' }, true, OTHER],
  ['allows plink in another project', 'Bash', { command: '"C:\\Program Files\\PuTTY\\plink.exe" -batch -agent -T user@host ls' }, false, OTHER],
  ['allows ssh in another project', 'Bash', { command: 'ssh -o BatchMode=yes user@host uptime' }, false, OTHER],
  ['allows scp in another project', 'PowerShell', { command: 'scp a user@host:b' }, false, OTHER],
  ['allows forge@ in another project', 'Bash', { command: 'plink forge@1.2.3.4 ls' }, false, OTHER],
  ['allows ssh in a non-CMS repo', 'Bash', { command: 'ssh host uptime' }, false, path.join(UNRELATED, 'sub')],
  ['allows sibling folder name prefix', 'Bash', { command: 'ssh host uptime' }, false, 'C:/laragon/www/cms-local-old'],
  ['allows plink write in another project', 'Write', { file_path: OTHER + '/deploy.ps1', content: 'plink -batch host ls' }, false, OTHER],
  // Fail-open / other tools
  ['ignores Read', 'Read', { file_path: 'x' }, false],
];

let failed = 0;
for (const [name, toolName, input, expectDeny, cwd = SM] of cases) {
  const got = denied(run(toolName, input, cwd));
  if (got !== expectDeny) {
    failed++;
    console.log('FAIL ' + name + ' — expected ' + (expectDeny ? 'deny' : 'allow') + ', got ' + (got ? 'deny' : 'allow'));
  } else {
    console.log('ok   ' + name);
  }
}
const r = spawnSync(process.execPath, [HOOK], { input: 'not json', encoding: 'utf8' });
if (r.status !== 0 || r.stdout.trim() !== '') { failed++; console.log('FAIL garbage stdin must fail open'); } else { console.log('ok   garbage stdin fails open'); }

fs.rmSync(TMP, { recursive: true, force: true });
console.log(failed ? '\n' + failed + ' failed' : '\nall passed');
process.exit(failed ? 1 : 0);
