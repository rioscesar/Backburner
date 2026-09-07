$ErrorActionPreference = 'Stop'
$packageRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$packageFiles = @('manifest.json','background.js','review.html','review.css','review.js','domain.js','store.js','removal.js','icons/icon16.png','icons/icon32.png','icons/icon48.png','icons/icon128.png')
$outputRoot = Join-Path $packageRoot 'dist'
[IO.Directory]::CreateDirectory($outputRoot) | Out-Null
$archivePath = Join-Path $outputRoot 'backburner.zip'
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression
# Overwrite only this explicitly named generated package, never source directories.
$archiveStream = [IO.File]::Open($archivePath, [IO.FileMode]::Create)
$archive = [IO.Compression.ZipArchive]::new($archiveStream, [IO.Compression.ZipArchiveMode]::Create)
try {
  foreach ($relative in $packageFiles) {
    $sourceFile = Join-Path $packageRoot $relative
    if (-not (Test-Path -LiteralPath $sourceFile -PathType Leaf)) { throw "Missing package file: $relative" }
    [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive,$sourceFile,$relative,[IO.Compression.CompressionLevel]::Optimal) | Out-Null
  }
} finally { $archive.Dispose(); $archiveStream.Dispose() }
$hashStream = [IO.File]::OpenRead($archivePath)
$sha = [Security.Cryptography.SHA256]::Create()
try { $hash = [BitConverter]::ToString($sha.ComputeHash($hashStream)).Replace('-','') }
finally { $hashStream.Dispose(); $sha.Dispose() }
[IO.File]::WriteAllText((Join-Path $outputRoot 'SHA256.txt'), "$hash  backburner.zip`n")
$unpackRoot = Join-Path $outputRoot 'unpacked'
if (Test-Path -LiteralPath $unpackRoot) {
  foreach ($existing in [IO.Directory]::GetFiles($unpackRoot,'*',[IO.SearchOption]::AllDirectories)) {
    $relative = $existing.Substring($unpackRoot.Length + 1).Replace('\','/')
    if ($relative -notin $packageFiles) { throw "Unexpected unpacked file: $relative. Use a new output directory; do not silently test stale files." }
  }
}
$zip = [IO.Compression.ZipFile]::OpenRead($archivePath)
try { foreach ($entry in $zip.Entries) {
  $target = [IO.Path]::GetFullPath((Join-Path $unpackRoot $entry.FullName))
  if (-not $target.StartsWith($unpackRoot + [IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe archive path' }
  [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target)) | Out-Null
  [IO.Compression.ZipFileExtensions]::ExtractToFile($entry,$target,$true)
} } finally { $zip.Dispose() }
Write-Output "PASS: packaged $($packageFiles.Count) runtime files. SHA256 $hash"
