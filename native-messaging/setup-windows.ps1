$ErrorActionPreference = "Stop"

$ScriptDir = $PSScriptRoot
$RepoRoot = Resolve-Path "$ScriptDir\.."
$CompanionScript = "$RepoRoot\companion\dist\index.js"
$LauncherPath = "$ScriptDir\run-companion.cmd"
$ManifestPath = "$ScriptDir\sleepy-tabs-companion.json"

Write-Host "Setting up Sleepy Tabs Guardian Native Host for Windows..."
Write-Host "Repo Root: $RepoRoot"

# 1. Create run-companion.cmd
Write-Host "Creating launcher script at $LauncherPath..."
# Use 'node' from PATH. If specific path needed, user can edit.
$LauncherContent = "@echo off`r`nnode ""$CompanionScript"" %*"
Set-Content -Path $LauncherPath -Value $LauncherContent
Write-Host "Launcher created."

# 2. Get Extension ID
$ExtensionId = Read-Host "Enter your Chrome Extension ID (from chrome://extensions)"
if ([string]::IsNullOrWhiteSpace($ExtensionId)) {
    Write-Error "Extension ID is required."
}

# 3. Create Manifest
Write-Host "Creating manifest at $ManifestPath..."
$Manifest = @{
    name = "com.sleepytabs.companion"
    description = "Sleepy Tabs Guardian Native Messaging Host"
    path = $LauncherPath
    type = "stdio"
    allowed_origins = @("chrome-extension://$ExtensionId/")
}
$ManifestJson = $Manifest | ConvertTo-Json -Depth 2
Set-Content -Path $ManifestPath -Value $ManifestJson
Write-Host "Manifest created."

# 4. Register in Registry
$HostName = "com.sleepytabs.companion"
$RegPathChrome = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$HostName"
$RegPathEdge = "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\$HostName"

Write-Host "Registering for Chrome..."
if (-not (Test-Path $RegPathChrome)) {
    New-Item -Path $RegPathChrome -Force | Out-Null
}
Set-ItemProperty -Path $RegPathChrome -Name "(Default)" -Value $ManifestPath

Write-Host "Registering for Edge..."
if (-not (Test-Path $RegPathEdge)) {
    New-Item -Path $RegPathEdge -Force | Out-Null
}
Set-ItemProperty -Path $RegPathEdge -Name "(Default)" -Value $ManifestPath

Write-Host "Setup complete! Please restart your browser or reload the extension."
