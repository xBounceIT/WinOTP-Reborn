param(
    [ValidateSet("x64", "arm64")]
    [string]$Architecture = "x64",
    [ValidateSet("Debug", "Release")]
    [string]$Configuration = "Release",
    [string]$DotNetPath = "C:\Program Files\dotnet\dotnet.exe",
    [string]$IsccPath = "C:\Program Files (x86)\Inno Setup 6\ISCC.exe"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptRoot
$projectPath = Join-Path $repoRoot "WinOTP.csproj"
$installerScriptPath = Join-Path $repoRoot "installer\WinOTP.iss"
$publishDir = Join-Path $repoRoot "artifacts\publish\win-$Architecture"

if (-not (Test-Path $DotNetPath)) {
    throw "dotnet executable not found at '$DotNetPath'."
}

if (-not (Test-Path $IsccPath)) {
    throw "Inno Setup compiler not found at '$IsccPath'."
}

[xml]$project = Get-Content -Raw -Path $projectPath
$version = $project.Project.PropertyGroup.Version | Select-Object -First 1
if ([string]::IsNullOrWhiteSpace($version)) {
    throw "Version element was not found in '$projectPath'."
}

if (Test-Path $publishDir) {
    Remove-Item -Recurse -Force $publishDir
}

& $DotNetPath publish $projectPath `
    -c $Configuration `
    -r "win-$Architecture" `
    --self-contained false `
    -o $publishDir

& $IsccPath $installerScriptPath `
    "/DMyAppVersion=$version" `
    "/DMyAppArch=$Architecture" `
    "/DPublishDir=$publishDir"
