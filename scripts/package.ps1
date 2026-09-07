param(
  [switch]$NotificationTest
)

$ErrorActionPreference = 'Stop'
$packageRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$packageFiles = @('manifest.json','background.js','review.html','review.css','review.js','domain.js','store.js','removal.js','reminders.js','icons/icon16.png','icons/icon32.png','icons/icon48.png','icons/icon128.png')
$outputRoot = if ($NotificationTest) { Join-Path $packageRoot 'dist\notification-test' } else { Join-Path $packageRoot 'dist' }
[IO.Directory]::CreateDirectory($outputRoot) | Out-Null
$archivePath = Join-Path $outputRoot ($(if ($NotificationTest) { 'backburner-notification-test.zip' } else { 'backburner.zip' }))
$unpackRoot = Join-Path $outputRoot 'unpacked'
[string[]]$notificationTestOutputFiles = @([IO.Path]::GetFileName($archivePath),'SHA256.txt') + ($packageFiles | ForEach-Object { "unpacked/$($_)" })
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression

function Test-UnexpectedGeneratedFile([string]$Root, [string[]]$AllowedRelativeFiles) {
  if (-not (Test-Path -LiteralPath $Root -PathType Container)) { return }
  foreach ($existing in [IO.Directory]::GetFiles($Root,'*',[IO.SearchOption]::AllDirectories)) {
    $relative = $existing.Substring($Root.Length + 1).Replace('\','/')
    if ($relative -notin $AllowedRelativeFiles) { throw "Unexpected generated file: $relative. Use a separate output directory; do not silently package stale files." }
  }
}

if ($NotificationTest) {
  Test-UnexpectedGeneratedFile -Root $outputRoot -AllowedRelativeFiles $notificationTestOutputFiles
  Test-UnexpectedGeneratedFile -Root $unpackRoot -AllowedRelativeFiles $packageFiles
  & node (Join-Path $packageRoot 'scripts\notification-test.mjs') --source-root $packageRoot --output-root $unpackRoot
  if ($LASTEXITCODE -ne 0) { throw 'Notification test artifact generation failed.' }
}

# Overwrite only this explicitly named generated package, never source directories.
$archiveStream = [IO.File]::Open($archivePath, [IO.FileMode]::Create)
$archive = [IO.Compression.ZipArchive]::new($archiveStream, [IO.Compression.ZipArchiveMode]::Create)
try {
  foreach ($relative in $packageFiles) {
    $sourceFile = if ($NotificationTest) { Join-Path $unpackRoot $relative } else { Join-Path $packageRoot $relative }
    if (-not (Test-Path -LiteralPath $sourceFile -PathType Leaf)) { throw "Missing package file: $relative" }
    [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive,$sourceFile,$relative,[IO.Compression.CompressionLevel]::Optimal) | Out-Null
  }
} finally { $archive.Dispose(); $archiveStream.Dispose() }
$hashStream = [IO.File]::OpenRead($archivePath)
$sha = [Security.Cryptography.SHA256]::Create()
try { $hash = [BitConverter]::ToString($sha.ComputeHash($hashStream)).Replace('-','') }
finally { $hashStream.Dispose(); $sha.Dispose() }
[IO.File]::WriteAllText((Join-Path $outputRoot 'SHA256.txt'), "$hash  $([IO.Path]::GetFileName($archivePath))`n")
if (-not $NotificationTest) {
  Test-UnexpectedGeneratedFile -Root $unpackRoot -AllowedRelativeFiles $packageFiles
  $zip = [IO.Compression.ZipFile]::OpenRead($archivePath)
  try { foreach ($entry in $zip.Entries) {
    $target = [IO.Path]::GetFullPath((Join-Path $unpackRoot $entry.FullName))
    if (-not $target.StartsWith($unpackRoot + [IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe archive path' }
    [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target)) | Out-Null
    [IO.Compression.ZipFileExtensions]::ExtractToFile($entry,$target,$true)
  } } finally { $zip.Dispose() }
} else {
  Test-UnexpectedGeneratedFile -Root $outputRoot -AllowedRelativeFiles $notificationTestOutputFiles
}
Write-Output "PASS: packaged $($packageFiles.Count) runtime files to $archivePath. SHA256 $hash"
