# PowerShell bootstrap for Windows x64. Also supports: & .\install.ps1 @args
& {
    $SetupArguments = @($args)
    $ErrorActionPreference = 'Stop'
    if ($env:OS -ne 'Windows_NT') {
        throw 'Prism standalone setup supports Windows x64. Linux/macOS use install.sh.'
    }
    # Win32_Processor.Architecture: x64=9, ARM64=12. Works in Windows PowerShell 5.1 too.
    $architectures = @(Get-CimInstance -ClassName Win32_Processor -Property Architecture |
        Select-Object -ExpandProperty Architecture -Unique)
    if (-not [Environment]::Is64BitOperatingSystem -or $architectures.Count -ne 1 -or $architectures[0] -ne 9) {
        throw 'Prism standalone setup supports Windows x64. Linux/macOS use install.sh.'
    }
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $base = 'https://github.com/shriram-ethiraj/prism/releases/download/main-build'
    $root = if ($env:PRISM_INSTALL_DIR) { $env:PRISM_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA 'Prism\installers' }
    function Assert-NoLink([string] $Path) {
        $item = Get-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
        if ($item -and ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            throw 'Installer paths must not be symbolic links or junctions.'
        }
    }
    Assert-NoLink $root
    New-Item -ItemType Directory -Path $root -Force | Out-Null
    $root = (Resolve-Path -LiteralPath $root).Path
    $work = Join-Path $root ('.download.' + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $work | Out-Null
    try {
        $manifestPath = Join-Path $work 'downloads.txt'
        Invoke-WebRequest -UseBasicParsing -Uri "$base/downloads.txt" -OutFile $manifestPath
        $manifest = @(Get-Content -LiteralPath $manifestPath)
        if ($manifest[0] -ne '# prism-downloads-v1') { throw 'Unsupported download manifest.' }
        $rows = @($manifest | Where-Object { $_ -match '^windows-x64 ' })
        if ($rows.Count -ne 1) { throw 'Download manifest has no unique Windows entry.' }
        $fields = $rows[0] -split ' '
        if ($fields.Count -ne 5) { throw 'Invalid download manifest row.' }
        $asset, $digest, $commit, $version = $fields[1..4]
        if ($commit -cnotmatch '^[a-f0-9]{40}$' -or $digest -cnotmatch '^[a-f0-9]{64}$' -or
            $version -notmatch '^\d+\.\d+\.\d+$' -or $asset -cne "prism-setup-windows-x64-$commit.zip") {
            throw 'Invalid download manifest fields.'
        }
        $destination = Join-Path $root "windows-x64-$commit"
        Assert-NoLink $destination
        if (-not (Test-Path -LiteralPath $destination)) {
            Write-Host "Downloading Prism $version for Windows x64..."
            $archive = Join-Path $work 'installer.zip'
            Invoke-WebRequest -UseBasicParsing -Uri "$base/$asset" -OutFile $archive
            if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -cne $digest) {
                throw 'Download checksum mismatch. Nothing was run; retry the command.'
            }
            Add-Type -AssemblyName System.IO.Compression.FileSystem
            $zip = [IO.Compression.ZipFile]::OpenRead($archive)
            try {
                foreach ($entry in $zip.Entries) {
                    if ($entry.FullName -match '(^|[/\\])\.\.([/\\]|$)|^[\\/]|:' -or
                        $entry.FullName -notmatch '^prism-setup(/|$)') { throw 'Unsafe installer archive paths.' }
                }
            } finally { $zip.Dispose() }
            $unpacked = Join-Path $work 'unpacked'
            Expand-Archive -LiteralPath $archive -DestinationPath $unpacked
            $candidate = Join-Path $unpacked 'prism-setup\prism-setup.exe'
            & $candidate --self-check
            if ($LASTEXITCODE -ne 0) { throw 'Installer failed its offline check.' }
            # Atomic directory rename; an existing destination is never overwritten.
            [IO.Directory]::Move((Join-Path $unpacked 'prism-setup'), $destination)
        }
        $executable = Join-Path $destination 'prism-setup.exe'
        & $executable --self-check
        if ($LASTEXITCODE -ne 0) { throw "Cached installer is damaged. Remove $destination and retry." }
        Write-Host "Installer: $executable"
        & $executable @SetupArguments
        if ($LASTEXITCODE -ne 0) { throw "Prism setup exited with code $LASTEXITCODE. Preserve private recovery records." }
    } finally {
        Remove-Item -LiteralPath $work -Recurse -Force
    }
} @args
