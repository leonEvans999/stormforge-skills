param(
  [string]$DestinationRoot = "$env:USERPROFILE\.codex\skills",
  [switch]$Force
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$sourceRoot = Join-Path $repoRoot "skills"

if (-not (Test-Path -LiteralPath $sourceRoot)) {
  throw "Missing skills directory: $sourceRoot"
}

New-Item -ItemType Directory -Force -Path $DestinationRoot | Out-Null
$resolvedDestinationRoot = (Resolve-Path -LiteralPath $DestinationRoot).Path.TrimEnd('\')

$installed = @()
Get-ChildItem -LiteralPath $sourceRoot -Directory | ForEach-Object {
  $target = Join-Path $resolvedDestinationRoot $_.Name

  if ((Test-Path -LiteralPath $target) -and -not $Force) {
    throw "Skill already exists: $target. Re-run with -Force to replace it."
  }

  if (Test-Path -LiteralPath $target) {
    $resolvedTarget = (Resolve-Path -LiteralPath $target).Path
    if (-not $resolvedTarget.StartsWith($resolvedDestinationRoot + '\')) {
      throw "Refusing to remove unexpected path: $resolvedTarget"
    }
    Remove-Item -LiteralPath $resolvedTarget -Recurse -Force
  }

  Copy-Item -LiteralPath $_.FullName -Destination $target -Recurse -Force
  $installed += $target
}

if ($installed.Count -eq 0) {
  throw "No skill directories found in $sourceRoot"
}

Write-Host "Installed skills:"
$installed | ForEach-Object { Write-Host "- $_" }
