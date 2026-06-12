<#
.SYNOPSIS
  Convert Obsidian Tasks query blocks to SilverBullet (and back), wrapping
  obsidian_silverbullet_queries.py. Tuned for migrating a vault into SilverBullet.

  Keep this file next to obsidian_silverbullet_queries.py.

.EXAMPLES
  .\sbconvert.ps1                       # PREVIEW converting the whole space
  .\sbconvert.ps1 -Apply                # apply (git snapshot + .bak backups first)
  .\sbconvert.ps1 -Path 'Dashboard.md'  # one file (preview)
  .\sbconvert.ps1 -Path 'Dashboard.md' -Apply
  .\sbconvert.ps1 -ToObsidian -Path 'X.md'   # reverse direction

.NOTES
  Migration flow: copy your Obsidian vault's .md files into the space folder
  (default C:\Tools\wiki), make sure Obsidian Tasks used the Dataview format,
  then run this to convert the query blocks.
#>
[CmdletBinding()]
param(
  [string] $Path   = 'C:\Tools\wiki',                                  # file or folder
  [switch] $Apply,                                                     # default = preview
  [switch] $ToObsidian,                                                # reverse direction
  [string] $Script = (Join-Path $PSScriptRoot 'obsidian_silverbullet_queries.py')
)

$ErrorActionPreference = 'Stop'

# Locate a Python 3 interpreter.
$py = $null
foreach ($c in @('python', 'py', 'python3')) {
  $cmd = Get-Command $c -ErrorAction SilentlyContinue
  if ($cmd) { $py = $cmd.Source; break }
}
if (-not $py)            { throw "Python 3 not found on PATH. Install it or edit this script." }
if (-not (Test-Path $Script)) { throw "Converter not found: $Script" }
if (-not (Test-Path $Path))   { throw "Path not found: $Path" }

$direction = if ($ToObsidian) { 'obsidian' } else { 'silverbullet' }

# Safety net: take a git snapshot before writing, if the target is in a repo.
if ($Apply) {
  $dir = if (Test-Path $Path -PathType Container) { $Path } else { Split-Path -Parent $Path }
  Push-Location $dir
  try {
    git rev-parse --is-inside-work-tree 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) {
      Write-Host 'Taking a git snapshot before applying...' -ForegroundColor Cyan
      git add -A 2>$null | Out-Null
      git commit -m "Snapshot before query conversion ($direction)" 2>$null | Out-Null
    }
  } finally { Pop-Location }
}

$argv = @($Script, '--to', $direction, $Path)
if ($Apply) { $argv += '--in-place' }

Write-Host ("Running: {0} {1}" -f $py, ($argv -join ' ')) -ForegroundColor DarkGray
& $py @argv

if (-not $Apply) {
  Write-Host "`nPREVIEW only. Re-run with -Apply to write changes (originals saved as *.bak, plus a git snapshot)." -ForegroundColor Yellow
}
