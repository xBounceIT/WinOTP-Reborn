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

function Get-ExpectedPublishedWinUIResources {
    param(
        [Parameter(Mandatory)]
        [string]$RepositoryRoot
    )

    $excludeSegments = @(
        [IO.Path]::DirectorySeparatorChar + "bin" + [IO.Path]::DirectorySeparatorChar,
        [IO.Path]::DirectorySeparatorChar + "obj" + [IO.Path]::DirectorySeparatorChar,
        [IO.Path]::DirectorySeparatorChar + "WinOTP.Tests" + [IO.Path]::DirectorySeparatorChar
    )

    $xamlFiles = Get-ChildItem -Path $RepositoryRoot -Recurse -Filter *.xaml -File | Where-Object {
        $fullName = $_.FullName
        foreach ($segment in $excludeSegments) {
            if ($fullName.Contains($segment, [System.StringComparison]::OrdinalIgnoreCase)) {
                return $false
            }
        }

        return $true
    }

    $expectedResources = foreach ($file in $xamlFiles) {
        if ($file.Name -ieq "App.xaml" -or $file.Name -ieq "MainWindow.xaml" -or $file.DirectoryName.StartsWith((Join-Path $RepositoryRoot "Pages"), [System.StringComparison]::OrdinalIgnoreCase)) {
            $relativePath = [IO.Path]::GetRelativePath($RepositoryRoot, $file.FullName)
            [IO.Path]::ChangeExtension($relativePath, ".xbf")
        }
    }

    @("WinOTP.pri") + ($expectedResources | Sort-Object -Unique)
}

function Assert-PublishedWinUIResources {
    param(
        [Parameter(Mandatory)]
        [string]$RepositoryRoot,
        [Parameter(Mandatory)]
        [string]$PublishDirectory
    )

    $missingResources = Get-ExpectedPublishedWinUIResources -RepositoryRoot $RepositoryRoot | Where-Object {
        -not (Test-Path (Join-Path $PublishDirectory $_))
    }

    if ($missingResources.Count -gt 0) {
        $formattedMissingResources = $missingResources | ForEach-Object { " - $_" }
        $message = @(
            "The publish output is missing required WinUI resources:",
            $formattedMissingResources,
            "Publish directory: $PublishDirectory"
        ) -join [Environment]::NewLine

        throw $message
    }
}

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

$assetVersion = $version.Trim()
if ($assetVersion.StartsWith("v", [System.StringComparison]::OrdinalIgnoreCase)) {
    $assetVersion = $assetVersion.Substring(1)
}

$buildMetadataSeparatorIndex = $assetVersion.IndexOf("+", [System.StringComparison]::Ordinal)
if ($buildMetadataSeparatorIndex -ge 0) {
    $assetVersion = $assetVersion.Substring(0, $buildMetadataSeparatorIndex)
}

if ([string]::IsNullOrWhiteSpace($assetVersion)) {
    throw "Version '$version' could not be normalized for the installer asset filename."
}

if (Test-Path $publishDir) {
    Remove-Item -Recurse -Force $publishDir
}

& $DotNetPath publish $projectPath `
    -c $Configuration `
    -r "win-$Architecture" `
    --self-contained true `
    -p:WindowsAppSDKSelfContained=true `
    -o $publishDir

Assert-PublishedWinUIResources -RepositoryRoot $repoRoot -PublishDirectory $publishDir

& $IsccPath $installerScriptPath `
    "/DMyAppVersion=$version" `
    "/DMyAppAssetVersion=$assetVersion" `
    "/DMyAppArch=$Architecture" `
    "/DPublishDir=$publishDir"
