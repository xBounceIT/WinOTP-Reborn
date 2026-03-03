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

    $normalizedRepositoryRoot = $RepositoryRoot.TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
    $xamlFiles = @()

    foreach ($xamlPath in @(
        (Join-Path $RepositoryRoot "App.xaml"),
        (Join-Path $RepositoryRoot "MainWindow.xaml")
    )) {
        if (Test-Path $xamlPath) {
            $xamlFiles += Get-Item $xamlPath
        }
    }

    $pagesDirectory = Join-Path $RepositoryRoot "Pages"
    if (Test-Path $pagesDirectory) {
        $xamlFiles += Get-ChildItem -Path $pagesDirectory -Recurse -Filter *.xaml -File
    }

    $expectedResources = foreach ($file in $xamlFiles) {
        $relativePath = $file.FullName.Substring($normalizedRepositoryRoot.Length).TrimStart([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
        [IO.Path]::ChangeExtension($relativePath, ".xbf")
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

    $missingResources = @(Get-ExpectedPublishedWinUIResources -RepositoryRoot $RepositoryRoot | Where-Object {
        -not (Test-Path (Join-Path $PublishDirectory $_))
    })

    if ($missingResources.Count -gt 0) {
        $formattedMissingResources = $missingResources | ForEach-Object { " - $_" }
        $messageLines = @("The publish output is missing required WinUI resources:")
        $messageLines += $formattedMissingResources
        $messageLines += "Publish directory: $PublishDirectory"
        $message = $messageLines -join [Environment]::NewLine

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
