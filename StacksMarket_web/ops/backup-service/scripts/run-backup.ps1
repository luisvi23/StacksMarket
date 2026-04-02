$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $scriptDir
Push-Location $root
try {
  npm run backup
}
finally {
  Pop-Location
}
