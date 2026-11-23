<#
.SYNOPSIS
  Open the BELAY dev container on the Docker Sandbox microVM in ONE step.

.DESCRIPTION
  Replaces the four-step manual dance:

      1. open VS Code
      2. Remote-SSH: Connect to Host        -> belay.sbx
      3. File > Open Folder                 -> /workspaces/belay
      4. Dev Containers: Attach to Running Container

  VS Code can address a dev container that lives inside a remote SSH host directly, with a single
  compound URI:

      vscode-remote://dev-container+<hex>@ssh-remote+<host>/<workspace>

  where <hex> is the hex-encoded UTF-8 of a small JSON descriptor. This script builds that URI and
  hands it to `code --folder-uri`, which lands straight in the container.

  THE HEX IS GENERATED, NOT PASTED. A hardcoded URI silently opens the WRONG target the moment the
  workspace path or the config file moves, and "wrong target" means a window that looks correct
  while running somewhere else. Generating it from the same inputs keeps it honest.

  IT ALSO HANDLES THE IDLE-STOP. The microVM stops ~30 s after the last session disconnects, so the
  common case is that the sandbox is NOT running when you come back to it. Attaching to a stopped
  sandbox fails in a way that reads like a broken environment, so this checks and starts it first.
  `sbx start` does not exist: `sbx run --name <n>` is the restart path, and passing the name is
  what re-attaches rather than creating a second sandbox.

.PARAMETER Sandbox
  Sandbox name. Default: belay

.PARAMETER Workspace
  Workspace folder INSIDE the VM. Default: /workspaces/belay

.PARAMETER Config
  devcontainer.json path inside the VM. Default: /workspaces/belay/.devcontainer/devcontainer.json

.PARAMETER SshHost
  SSH host alias for the sandbox, as configured by `sbx setup ssh`. Default: <sandbox>.sbx

.PARAMETER PrintOnly
  Print the URI and exit without launching VS Code (useful for building a shortcut).

.EXAMPLE
  # Windows PowerShell 5.1 (the default shell on Windows): no PowerShell 7 required.
  .\scripts\open-sandbox.ps1
.EXAMPLE
  .\scripts\open-sandbox.ps1 -PrintOnly
.NOTES
  If script execution is blocked by policy:
      powershell -ExecutionPolicy Bypass -File .\scripts\open-sandbox.ps1
  Feature 004. Procedure and traps: docs/runbooks/devcontainer.md.
#>
[CmdletBinding()]
param(
  [string]$Sandbox   = 'belay',
  [string]$Workspace = '/workspaces/belay',
  [string]$Config    = '/workspaces/belay/.devcontainer/devcontainer.json',
  [string]$SshHost   = '',
  [switch]$PrintOnly
)

$ErrorActionPreference = 'Stop'
if (-not $SshHost) { $SshHost = "$Sandbox.sbx" }

function Test-Cmd([string]$Name) {
  $c = Get-Command $Name -ErrorAction SilentlyContinue
  return [bool]$c
}

# -- Invoke-Native: the ONLY way this script calls an external executable --------------------------
#
# WINDOWS POWERSHELL 5.1 TRAP. In 5.1 every stderr line from a native exe is wrapped in an
# ErrorRecord (NativeCommandError). With $ErrorActionPreference = 'Stop' that becomes a TERMINATING
# error even when the exe exits 0. Both tools this script drives write routine progress to stderr
# ("Attaching to existing sandbox ...", "Connecting to sandbox ..."), so a perfectly successful
# command aborted the script. Fixing it at one call site only moves the bug, so every native call
# goes through here. The exit code is the only trustworthy signal from a native command.
function Invoke-Native {
  param([Parameter(Mandatory)][string]$Exe, [string[]]$Arguments = @(), [switch]$Capture)
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    if ($Capture) { $out = & $Exe @Arguments 2>&1 } else { & $Exe @Arguments 2>&1 | Out-Null; $out = $null }
    return [pscustomobject]@{ ExitCode = $LASTEXITCODE; Output = $out }
  } finally { $ErrorActionPreference = $prev }
}

if (-not (Test-Cmd 'sbx')) {
  throw "sbx not on PATH. Add %LOCALAPPDATA%\DockerSandboxes\bin to PATH, or run the full path."
}

# -- 1. make sure the sandbox is actually running ---------------------------------------------------
# Structured output, not the table: the human-readable listing changes between sbx releases, and
# `--format json` is a bare array of { name, status, ... }. Invoke-Native merges stderr into the
# capture, and sbx sends daemon-start progress there, so ErrorRecords are dropped before parsing.
$ls = Invoke-Native -Exe 'sbx' -Arguments @('ls', '--format', 'json') -Capture
# A failed `sbx ls` must NOT fall through to parsing: its error is on stderr (dropped below), the
# remaining stdout is empty, and an empty list then reads as "sandbox does not exist". Seen after a
# host reboot, where the real cause was "error: not signed in to Docker" (fix: `sbx login`).
if ($ls.ExitCode -ne 0) {
  throw "'sbx ls' failed (exit $($ls.ExitCode)): $(($ls.Output | Out-String).Trim())"
}
$json = ($ls.Output | Where-Object { $_ -isnot [System.Management.Automation.ErrorRecord] }) -join "`n"
try { $sandboxes = @($json | ConvertFrom-Json) } catch {
  throw "could not parse 'sbx ls --format json' (exit $($ls.ExitCode)): $json"
}
$entry = $sandboxes | Where-Object { $_.name -eq $Sandbox } | Select-Object -First 1
if (-not $entry) {
  throw "sandbox '$Sandbox' does not exist. Create it first: docs/runbooks/devcontainer.md, bring-up from nothing."
}

if ($entry.status -eq 'running') {
  Write-Host "  sandbox '$Sandbox' is already running"
} else {
  Write-Host "  sandbox '$Sandbox' is stopped (the microVM idle-stops ~30s after the last session) - starting..."
  # -d prints the id and exits rather than opening an interactive session; --name re-attaches to the
  # EXISTING sandbox (without it, the positional agent argument would create a new one).
  $run = Invoke-Native -Exe 'sbx' -Arguments @('run', '--name', $Sandbox, '-d') -Capture

  # DO NOT TRUST THIS EXIT CODE. `sbx run` can report
  #     500 Internal Server Error: docker daemon failed to start inside the sandbox
  # while dockerd is in fact starting normally: it restores every restartable container first, which
  # measured 54-101 s, and sbx's readiness budget is a compiled-in constant below that, with no flag
  # or setting to raise it. sbx gives up, the CLI exits, and that exit starts the ~30 s idle-stop.
  # The exit code is a CLAIM; SSH answering is EVIDENCE. A genuinely broken sandbox never answers the
  # probe below, and we then throw with the original exit code and output attached.
  if ($run.ExitCode -ne 0) {
    Write-Host "  sbx run reported exit $($run.ExitCode) - checking SSH before believing it (see docs/runbooks/devcontainer.md)"
  }

  # Wait for SSH rather than assuming: VS Code's attach fails confusingly if it races the boot.
  # Deadline-based rather than iteration-based: each attempt costs up to ConnectTimeout PLUS the
  # sleep, so a fixed loop count does not mean a fixed number of seconds.
  $deadlineSeconds = 120
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  $ready = $false
  while ($sw.Elapsed.TotalSeconds -lt $deadlineSeconds) {
    $probe = Invoke-Native -Exe 'ssh' -Arguments @(
      '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=no', '-o', 'ConnectTimeout=3', $SshHost, 'true')
    if ($probe.ExitCode -eq 0) { $ready = $true; break }
    Start-Sleep -Seconds 2
  }
  $sw.Stop()
  if (-not $ready) {
    $detail = "sandbox '$Sandbox' did not answer SSH on $SshHost within $deadlineSeconds s."
    if ($run.ExitCode -ne 0) {
      $detail += " sbx run had exited $($run.ExitCode): $(($run.Output | Out-String).Trim())"
    }
    throw "$detail Check: sbx ls / ssh $SshHost"
  }
  Write-Host ("  sandbox is up and answering SSH ({0:N0}s)" -f $sw.Elapsed.TotalSeconds)
}

# -- 2. build the compound URI -----------------------------------------------------------------------
# Key order and the "$mid":1 member are reproduced exactly as VS Code emits them. JSON is
# order-insensitive to a parser, but matching the observed form keeps this diffable against a real
# URI when something changes in a future VS Code release.
$descriptor = '{"hostPath":"' + $Workspace + '","localDocker":false,"configFile":{"$mid":1,"path":"' +
              $Config + '","scheme":"vscode-fileHost"}}'

$bytes = [System.Text.Encoding]::UTF8.GetBytes($descriptor)
$hex   = -join ($bytes | ForEach-Object { $_.ToString('x2') })

# '+' must be percent-encoded as %2B in both authority segments, or VS Code reads the URI as a
# malformed authority and silently opens a local window instead.
$uri = "vscode-remote://dev-container%2B$hex@ssh-remote%2B$SshHost$Workspace"

if ($PrintOnly) { Write-Output $uri; exit 0 }

if (-not (Test-Cmd 'code')) {
  Write-Host "  'code' is not on PATH - open this URI manually:`n"
  Write-Output $uri
  exit 0
}

Write-Host "  opening VS Code in the dev container..."
& code --folder-uri $uri
Write-Host "  done. VS Code should land directly inside the container (no Attach step needed)."
