param(
  [string]$DestinationRoot = "$env:USERPROFILE\.codex\skills",
  [switch]$Apply
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$sourceRoot = Join-Path $repoRoot "skills"

if (-not (Test-Path -LiteralPath $sourceRoot)) {
  throw "Missing skills directory: $sourceRoot"
}

$skillDirs = @(Get-ChildItem -LiteralPath $sourceRoot -Directory)
if ($skillDirs.Count -eq 0) {
  throw "No skill directories found in $sourceRoot"
}

if (-not $Apply) {
  Write-Host "Dry run: would sync these skills into $DestinationRoot"
  $skillDirs | ForEach-Object { Write-Host "- $($_.Name)" }
  Write-Host "Re-run with -Apply to copy files."
  exit 0
}

New-Item -ItemType Directory -Force -Path $DestinationRoot | Out-Null
$resolvedDestinationRoot = (Resolve-Path -LiteralPath $DestinationRoot).Path.TrimEnd('\')

$synced = @()
$skillDirs | ForEach-Object {
  $target = Join-Path $resolvedDestinationRoot $_.Name
  if (Test-Path -LiteralPath $target) {
    $resolvedTarget = (Resolve-Path -LiteralPath $target).Path
    if (-not $resolvedTarget.StartsWith($resolvedDestinationRoot + '\')) {
      throw "Refusing to remove unexpected path: $resolvedTarget"
    }
    Remove-Item -LiteralPath $resolvedTarget -Recurse -Force
  }
  Copy-Item -LiteralPath $_.FullName -Destination $target -Recurse -Force
  $synced += $target
}

Write-Host "Synced skills:"
$synced | ForEach-Object { Write-Host "- $_" }
