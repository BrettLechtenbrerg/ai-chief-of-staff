[CmdletBinding()]
param(
  [string]$OutputDirectory = [Environment]::GetFolderPath('Desktop')
)

$ErrorActionPreference = 'Stop'
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$workDirectory = Join-Path $env:TEMP "acos-rescue-$timestamp"
$zipPath = Join-Path $OutputDirectory "AI-Chief-of-Staff-rescue-$timestamp.zip"
New-Item -ItemType Directory -Force -Path $workDirectory, $OutputDirectory | Out-Null

function Write-ReportFile {
  param([string]$Name, [object]$Value)
  $path = Join-Path $workDirectory $Name
  $Value | Out-File -FilePath $path -Encoding utf8 -Width 4096
}

function Protect-PrivateText {
  param([string]$Text)
  if ([string]::IsNullOrEmpty($Text)) { return $Text }
  $protected = $Text
  if ($env:USERPROFILE) {
    $protected = $protected.Replace($env:USERPROFILE, '<USERPROFILE>')
  }
  $protected = [regex]::Replace($protected, '(?i)Bearer\s+[A-Za-z0-9._~+/=-]+', 'Bearer <REDACTED>')
  $protected = [regex]::Replace($protected, '(?i)\bsk-[A-Za-z0-9_-]{12,}\b', '<API_KEY_REDACTED>')
  $protected = [regex]::Replace($protected, '(?i)(api[_-]?key|token|secret|password)(["''\s:=]+)([^\s,"''}]+)', '$1$2<REDACTED>')
  $protected = [regex]::Replace($protected, '\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b', '<EMAIL_REDACTED>', 'IgnoreCase')
  return $protected
}

function Get-PeMachine {
  param([string]$Path)
  try {
    $stream = [System.IO.File]::OpenRead($Path)
    try {
      $reader = New-Object System.IO.BinaryReader($stream)
      if ($reader.ReadUInt16() -ne 0x5A4D) { return 'not-pe' }
      $stream.Position = 0x3c
      $peOffset = $reader.ReadUInt32()
      $stream.Position = $peOffset
      if ($reader.ReadUInt32() -ne 0x00004550) { return 'invalid-pe' }
      $machine = $reader.ReadUInt16()
      switch ($machine) {
        0x8664 { return 'x64 (0x8664)' }
        0xAA64 { return 'arm64 (0xAA64)' }
        0x014C { return 'x86 (0x014C)' }
        default { return ('unknown (0x{0:X4})' -f $machine) }
      }
    } finally {
      $stream.Dispose()
    }
  } catch {
    return "unreadable: $($_.Exception.Message)"
  }
}

try {
  $os = Get-CimInstance Win32_OperatingSystem
  $computer = Get-CimInstance Win32_ComputerSystem
  $system = [ordered]@{
    CollectedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
    Windows = $os.Caption
    WindowsVersion = $os.Version
    WindowsBuild = $os.BuildNumber
    OsArchitecture = $os.OSArchitecture
    ProcessArchitecture = $env:PROCESSOR_ARCHITECTURE
    Is64BitOperatingSystem = [Environment]::Is64BitOperatingSystem
    Manufacturer = $computer.Manufacturer
    Model = $computer.Model
    PowerShell = $PSVersionTable.PSVersion.ToString()
  }
  Write-ReportFile 'system.txt' ($system | Format-List | Out-String)

  $uninstallRoots = @(
    'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
  )
  $installRecords = foreach ($root in $uninstallRoots) {
    Get-ItemProperty $root -ErrorAction SilentlyContinue |
      Where-Object { $_.DisplayName -like '*AI Chief of Staff*' } |
      Select-Object DisplayName, DisplayVersion, InstallLocation, InstallSource, Publisher, UninstallString
  }
  Write-ReportFile 'install-records.txt' ($installRecords | Format-List | Out-String)

  $executableCandidates = @(
    (Join-Path $env:LOCALAPPDATA 'Programs\AI Chief of Staff\AI Chief of Staff.exe'),
    (Join-Path $env:LOCALAPPDATA 'Programs\ai-chief-of-staff\AI Chief of Staff.exe'),
    (Join-Path $env:ProgramFiles 'AI Chief of Staff\AI Chief of Staff.exe')
  ) | Select-Object -Unique
  $executable = $executableCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
  if ($executable) {
    $signature = Get-AuthenticodeSignature $executable
    $exeInfo = Get-Item $executable
    $executableReport = [ordered]@{
      Path = (Protect-PrivateText $executable)
      Version = $exeInfo.VersionInfo.FileVersion
      Size = $exeInfo.Length
      Sha256 = (Get-FileHash -Algorithm SHA256 $executable).Hash
      PeMachine = Get-PeMachine $executable
      SignatureStatus = $signature.Status
      Signer = if ($signature.SignerCertificate) { $signature.SignerCertificate.Subject } else { '<none>' }
    }
    Write-ReportFile 'executable.txt' ($executableReport | Format-List | Out-String)

    $resourceDirectory = Join-Path (Split-Path $executable) 'resources'
    $updaterMetadata = Join-Path $resourceDirectory 'app-update.yml'
    if (Test-Path $updaterMetadata) {
      $safeUpdater = Protect-PrivateText (Get-Content -Raw $updaterMetadata)
      Write-ReportFile 'app-update-redacted.yml' $safeUpdater
    }

    $nativeCandidates = @(
      (Join-Path $resourceDirectory 'app\node_modules\better-sqlite3\prebuilds\win32-x64.node'),
      (Join-Path $resourceDirectory 'app\node_modules\better-sqlite3\build\Release\better_sqlite3.node')
    )
    $nativeReports = foreach ($native in $nativeCandidates) {
      if (Test-Path $native) {
        [pscustomobject]@{
          Path = (Protect-PrivateText $native)
          Size = (Get-Item $native).Length
          PeMachine = Get-PeMachine $native
          Sha256 = (Get-FileHash -Algorithm SHA256 $native).Hash
        }
      }
    }
    Write-ReportFile 'native-modules.txt' ($nativeReports | Format-List | Out-String)

    $sqliteStatus = 'not attempted'
    $nativeModuleDirectory = $nativeCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
    if ($nativeModuleDirectory) {
      $moduleRoot = Join-Path $resourceDirectory 'app\node_modules\better-sqlite3'
      $previousRunAsNode = $env:ELECTRON_RUN_AS_NODE
      try {
        $env:ELECTRON_RUN_AS_NODE = '1'
        $probe = "const D=require(process.argv[1]);const d=new D(':memory:');d.prepare('select 1').get();d.close();console.log('SQLite load OK')"
        $sqliteStatus = (& $executable -e $probe $moduleRoot 2>&1 | Out-String).Trim()
        if ($LASTEXITCODE -ne 0) { $sqliteStatus = "SQLite load failed (exit $LASTEXITCODE): $sqliteStatus" }
      } catch {
        $sqliteStatus = "SQLite load failed: $($_.Exception.Message)"
      } finally {
        $env:ELECTRON_RUN_AS_NODE = $previousRunAsNode
      }
    }
    Write-ReportFile 'sqlite-load.txt' (Protect-PrivateText $sqliteStatus)
  } else {
    Write-ReportFile 'executable.txt' "AI Chief of Staff executable was not found in expected per-user or per-machine install paths."
    Write-ReportFile 'native-modules.txt' 'Native-module check unavailable because the executable was not found.'
    Write-ReportFile 'sqlite-load.txt' 'SQLite load check unavailable because the executable was not found.'
  }

  $userDataCandidates = @(
    (Join-Path $env:APPDATA 'AI Chief of Staff'),
    (Join-Path $env:APPDATA 'ai-chief-of-staff')
  ) | Select-Object -Unique
  $dataReport = foreach ($directory in $userDataCandidates) {
    if (-not (Test-Path $directory)) { continue }
    $database = Join-Path $directory 'ai-chief-of-staff.db'
    [pscustomobject]@{
      Directory = (Protect-PrivateText $directory)
      DatabaseExists = Test-Path $database
      DatabaseBytes = if (Test-Path $database) { (Get-Item $database).Length } else { 0 }
      WalBytes = if (Test-Path "$database-wal") { (Get-Item "$database-wal").Length } else { 0 }
      ShmBytes = if (Test-Path "$database-shm") { (Get-Item "$database-shm").Length } else { 0 }
      DatabaseAcl = if (Test-Path $database) { (Get-Acl $database).Sddl } else { '<missing>' }
    }
  }
  Write-ReportFile 'user-data-metadata.txt' ($dataReport | Format-List | Out-String)

  $startupHealth = $userDataCandidates |
    ForEach-Object { Join-Path $_ 'startup-health.json' } |
    Where-Object { Test-Path $_ } |
    Select-Object -First 1
  if ($startupHealth) {
    Write-ReportFile 'startup-health.json' (Protect-PrivateText (Get-Content -Raw $startupHealth))
  } else {
    Write-ReportFile 'startup-health.json' '{"status":"missing — app may not have reached IPC registration"}'
  }

  $logCandidates = foreach ($directory in $userDataCandidates) {
    @(
      (Join-Path $directory 'logs\main.log'),
      (Join-Path $directory 'logs\main.old.log'),
      (Join-Path $directory 'main.log')
    )
  }
  $copiedLogs = 0
  foreach ($logPath in $logCandidates | Select-Object -Unique) {
    if (-not (Test-Path $logPath)) { continue }
    $content = Get-Content -Raw $logPath
    if ($content.Length -gt 2000000) { $content = $content.Substring($content.Length - 2000000) }
    $safeContent = Protect-PrivateText $content
    Write-ReportFile ("log-{0}.txt" -f $copiedLogs) $safeContent
    $copiedLogs += 1
  }
  if ($copiedLogs -eq 0) {
    Write-ReportFile 'logs-not-found.txt' 'No application main-process logs were found in the expected user-data paths.'
  }

  $runningProcesses = Get-Process -Name 'AI Chief of Staff' -ErrorAction SilentlyContinue |
    Select-Object ProcessName, Id, StartTime, Path
  Write-ReportFile 'processes.txt' (Protect-PrivateText ($runningProcesses | Format-List | Out-String))

  @'
This archive intentionally excludes settings, tokens, message contents, and the SQLite database.
Paths, API-key patterns, bearer tokens, email addresses, and credential-like log fields are redacted.
Review every text file before sharing it with support.
'@ | Out-File (Join-Path $workDirectory 'PRIVACY.txt') -Encoding utf8

  if (Test-Path $zipPath) { Remove-Item -Force $zipPath }
  Compress-Archive -Path (Join-Path $workDirectory '*') -DestinationPath $zipPath -CompressionLevel Optimal
  Write-Host "Rescue archive created: $zipPath"
  Write-Host 'Review the archive before sending it to support.'
} finally {
  Remove-Item -Recurse -Force $workDirectory -ErrorAction SilentlyContinue
}
