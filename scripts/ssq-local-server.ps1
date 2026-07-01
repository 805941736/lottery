param(
  [int]$Port = 0,
  [switch]$Open
)
$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$DataRoot = Join-Path $ProjectRoot 'data'
Set-Location -LiteralPath $ProjectRoot
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$chartUrl = 'https://datachart.500.com/ssq/?expect=50'
$recordPath = Join-Path $DataRoot 'ssq-analysis-records.json'
$serverStatePath = Join-Path $DataRoot 'ssq-local-server.json'
$recordBackupRoot = Join-Path $DataRoot 'record-backups'

function Backup-RecordFile {
  if (-not (Test-Path -LiteralPath $recordPath -PathType Leaf)) { return }
  if (-not (Test-Path -LiteralPath $recordBackupRoot -PathType Container)) { New-Item -ItemType Directory -Path $recordBackupRoot | Out-Null }
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
  Copy-Item -LiteralPath $recordPath -Destination (Join-Path $recordBackupRoot "ssq-analysis-records-$stamp.json")
  Get-ChildItem -LiteralPath $recordBackupRoot -Filter 'ssq-analysis-records-*.json' | Sort-Object LastWriteTime -Descending | Select-Object -Skip 30 | Remove-Item -Force
}

function Test-ExistingServer([int]$candidatePort) {
  try {
    $response = Invoke-WebRequest -Uri "http://127.0.0.1:$candidatePort/" -UseBasicParsing -TimeoutSec 1
    return ($response.StatusCode -eq 200 -and $response.Content -like '*双色球分析标注*')
  } catch {
    return $false
  }
}
function Open-ExistingServerIfAvailable {
  if (-not $Open) { return $false }
  if (-not (Test-Path -LiteralPath $serverStatePath -PathType Leaf)) { return $false }
  try {
    $state = Get-Content -LiteralPath $serverStatePath -Raw -Encoding UTF8 | ConvertFrom-Json
    $statePort = [int]$state.port
    if ($statePort -gt 0 -and (Test-ExistingServer $statePort)) {
      Start-Process "http://127.0.0.1:$statePort/"
      return $true
    }
  } catch {}
  return $false
}
function Save-ServerState([int]$actualPort) {
  if (-not (Test-Path -LiteralPath $DataRoot -PathType Container)) { New-Item -ItemType Directory -Path $DataRoot | Out-Null }
  $state = [ordered]@{ port = $actualPort; startedAt = (Get-Date).ToString('o') }
  [IO.File]::WriteAllText($serverStatePath, ($state | ConvertTo-Json -Compress), [Text.UTF8Encoding]::new($false))
}

function New-ResponseBytes([string]$status, [string]$contentType, [byte[]]$body) {
  $headers = "HTTP/1.1 $status`r`nContent-Type: $contentType`r`nCache-Control: no-store, no-cache, must-revalidate`r`nContent-Length: $($body.Length)`r`nConnection: close`r`n`r`n"
  $head = [Text.Encoding]::ASCII.GetBytes($headers)
  $bytes = New-Object byte[] ($head.Length + $body.Length)
  [Array]::Copy($head, 0, $bytes, 0, $head.Length)
  [Array]::Copy($body, 0, $bytes, $head.Length, $body.Length)
  $bytes
}
function Write-Bytes($client, [byte[]]$bytes, [string]$contentType, [string]$status = '200 OK') {
  $response = New-ResponseBytes $status $contentType $bytes
  $stream = $client.GetStream()
  $stream.Write($response, 0, $response.Length)
}
function Write-Text($client, [string]$text, [string]$contentType = 'text/plain; charset=utf-8', [string]$status = '200 OK') {
  Write-Bytes $client ([Text.Encoding]::UTF8.GetBytes($text)) $contentType $status
}
function Get-HeaderEnd([byte[]]$bytes, [int]$length) {
  for ($i = 3; $i -lt $length; $i++) {
    if ($bytes[$i - 3] -eq 13 -and $bytes[$i - 2] -eq 10 -and $bytes[$i - 1] -eq 13 -and $bytes[$i] -eq 10) { return $i + 1 }
  }
  -1
}
function Read-HttpRequest($client) {
  $stream = $client.GetStream()
  $stream.ReadTimeout = 5000
  $buffer = New-Object byte[] 8192
  $memory = New-Object IO.MemoryStream
  $headerEnd = -1
  $contentLength = 0
  do {
    $count = $stream.Read($buffer, 0, $buffer.Length)
    if ($count -le 0) { break }
    $memory.Write($buffer, 0, $count)
    $bytes = $memory.ToArray()
    if ($headerEnd -lt 0) {
      $headerEnd = Get-HeaderEnd $bytes $bytes.Length
      if ($headerEnd -gt 0) {
        $headerText = [Text.Encoding]::ASCII.GetString($bytes, 0, $headerEnd)
        $lengthMatch = [regex]::Match($headerText, '(?im)^Content-Length:\s*(\d+)')
        if ($lengthMatch.Success) { $contentLength = [int]$lengthMatch.Groups[1].Value }
      }
    }
  } while ($headerEnd -lt 0 -or ($memory.Length -lt ($headerEnd + $contentLength)))
  $all = $memory.ToArray()
  if ($headerEnd -lt 0) { throw 'invalid http request' }
  $headers = [Text.Encoding]::ASCII.GetString($all, 0, $headerEnd) -split "`r`n"
  $requestLine = $headers[0] -split ' '
  $body = if ($contentLength -gt 0) { [Text.Encoding]::UTF8.GetString($all, $headerEnd, $contentLength) } else { '' }
  [pscustomobject]@{ Method = $requestLine[0]; Path = $requestLine[1]; Body = $body }
}
function Read-500Html {
  $response = Invoke-WebRequest -Uri $chartUrl -UseBasicParsing -TimeoutSec 30 -Headers @{ 'User-Agent' = 'Mozilla/5.0'; Referer = 'https://datachart.500.com/ssq/' }
  $memory = New-Object IO.MemoryStream
  $response.RawContentStream.CopyTo($memory)
  [Text.Encoding]::GetEncoding('gb2312').GetString($memory.ToArray())
}
function Parse-Cells([string]$html) {
  $cells = @()
  foreach ($match in [regex]::Matches($html, '<td\s([^>]*)>(.*?)</td>', 'IgnoreCase,Singleline')) {
    $attrs = $match.Groups[1].Value
    $text = [regex]::Replace($match.Groups[2].Value, '<[^>]+>', '').Trim()
    $cells += [pscustomobject]@{ Attrs = $attrs; Text = $text }
  }
  $cells
}
function Get-500Payload {
  $html = Read-500Html
  $rowMatches = [regex]::Matches($html, '<tr>\s*<td\s+align="center">\s*(\d{5})\s*</td>(.*?)</tr>', 'IgnoreCase,Singleline')
  $rows = @()
  foreach ($rowMatch in $rowMatches) {
    $issue = $rowMatch.Groups[1].Value
    $cells = Parse-Cells $rowMatch.Groups[2].Value
    $red = @()
    $blue = $null
    foreach ($cell in $cells) {
      if ($cell.Attrs -match 'chartBall01') { $red += [int]$cell.Text }
      if ($cell.Attrs -match 'chartBall02') { $blue = [int]$cell.Text }
    }
    if ($red.Count -eq 6 -and $blue) { $rows += [ordered]@{ issue = $issue; red = @($red); blue = $blue } }
  }
  $rows = @($rows | Sort-Object { [int]$_.issue })
  if (-not $rows.Count) { throw '未能从 500彩票网页面解析到双色球数据' }
  $latest = $rows[-1]
  $now = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
  [ordered]@{
    chart = [ordered]@{ generatedAt = $now; source = '500彩票网'; rows = $rows }
    latest = [ordered]@{ issue = '20' + $latest.issue; date = ''; red = @($latest.red | ForEach-Object { '{0:D2}' -f $_ }); blue = @('{0:D2}' -f $latest.blue); source = '500彩票网'; updatedAt = $now }
  }
}
function Merge-WithLocalHistory($payload) {
  $map = @{}
  $localPath = Join-Path $DataRoot 'chart-data.js'
  if (Test-Path -LiteralPath $localPath) {
    $raw = Get-Content -LiteralPath $localPath -Raw -Encoding UTF8
    $match = [regex]::Match($raw, 'window\.SSQ_CHART_DATA\s*=\s*(\{.*\})\s*;', 'Singleline')
    if ($match.Success) {
      try {
        $local = $match.Groups[1].Value | ConvertFrom-Json
        foreach ($row in @($local.rows)) { $map[[string]$row.issue] = [ordered]@{ issue = [string]$row.issue; red = @($row.red | ForEach-Object { [int]$_ }); blue = [int]$row.blue } }
      } catch {}
    }
  }
  $localRows = @($map.Values | Sort-Object { [int]$_.issue })
  $localLatest = if ($localRows.Count) { [int]$localRows[-1].issue } else { 0 }
  $incomingRows = @($payload.chart.rows | Sort-Object { [int]$_.issue })
  if ($localRows.Count -ge 50) {
    foreach ($row in @($incomingRows | Where-Object { [int]$_.issue -gt $localLatest })) { $map[[string]$row.issue] = [ordered]@{ issue = [string]$row.issue; red = @($row.red | ForEach-Object { [int]$_ }); blue = [int]$row.blue } }
  } else {
    foreach ($row in $incomingRows) { $map[[string]$row.issue] = [ordered]@{ issue = [string]$row.issue; red = @($row.red | ForEach-Object { [int]$_ }); blue = [int]$row.blue } }
  }
  $rows = @($map.Values | Sort-Object { [int]$_.issue } | Select-Object -Last 50)
  $payload.chart.rows = $rows
  $latest = $rows[-1]
  $payload.latest = [ordered]@{ issue = '20' + $latest.issue; date = ''; red = @($latest.red | ForEach-Object { '{0:D2}' -f $_ }); blue = @('{0:D2}' -f $latest.blue); source = '500彩票网'; updatedAt = $payload.chart.generatedAt }
  $payload
}
function Save-DataFiles($payload) {
  if (-not (Test-Path -LiteralPath $DataRoot -PathType Container)) { New-Item -ItemType Directory -Path $DataRoot | Out-Null }
  'window.SSQ_CHART_DATA = ' + (($payload.chart) | ConvertTo-Json -Depth 8 -Compress) + ';' | Set-Content -LiteralPath (Join-Path $DataRoot 'chart-data.js') -Encoding UTF8
  'window.SSQ_LATEST = ' + (($payload.latest) | ConvertTo-Json -Depth 8 -Compress) + ';' | Set-Content -LiteralPath (Join-Path $DataRoot 'latest-ssq.js') -Encoding UTF8
}
function Handle-Request($client, $request) {
  $requestPath = [uri]::UnescapeDataString(($request.Path -split '\?', 2)[0].TrimStart('/'))
  if ([string]::IsNullOrWhiteSpace($requestPath)) { $requestPath = 'app/index.html' }
  if ($requestPath -eq 'api/records') {
    if ($request.Method -eq 'GET') {
      if (Test-Path -LiteralPath $recordPath -PathType Leaf) { Write-Bytes $client ([IO.File]::ReadAllBytes($recordPath)) 'application/json; charset=utf-8' } else { Write-Text $client '{"error":"record file not found"}' 'application/json; charset=utf-8' '404 Not Found' }
      return
    }
    if ($request.Method -eq 'POST') {
      try { $null = $request.Body | ConvertFrom-Json } catch { Write-Text $client '{"error":"invalid json"}' 'application/json; charset=utf-8' '400 Bad Request'; return }
      if (-not (Test-Path -LiteralPath $DataRoot -PathType Container)) { New-Item -ItemType Directory -Path $DataRoot | Out-Null }
      Backup-RecordFile
      [IO.File]::WriteAllText($recordPath, $request.Body, [Text.UTF8Encoding]::new($false))
      Write-Text $client '{"ok":true}' 'application/json; charset=utf-8'
      return
    }
    Write-Text $client '{"error":"method not allowed"}' 'application/json; charset=utf-8' '405 Method Not Allowed'
    return
  }
  if ($requestPath -eq 'api/refresh') {
    $payload = Merge-WithLocalHistory (Get-500Payload)
    Save-DataFiles $payload
    Write-Text $client ($payload | ConvertTo-Json -Depth 8 -Compress) 'application/json; charset=utf-8'
    return
  }
  $fullPath = Join-Path $ProjectRoot $requestPath
  $resolvedRoot = (Resolve-Path -LiteralPath $ProjectRoot).Path.TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
  $resolvedFile = if (Test-Path -LiteralPath $fullPath -PathType Leaf) { (Resolve-Path -LiteralPath $fullPath).Path } else { $null }
  if ($resolvedFile -and ($resolvedFile.Equals($resolvedRoot, [StringComparison]::OrdinalIgnoreCase) -or $resolvedFile.StartsWith($resolvedRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or $resolvedFile.StartsWith($resolvedRoot + [IO.Path]::AltDirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase))) {
    $ext = [IO.Path]::GetExtension($fullPath).ToLowerInvariant()
    $type = switch ($ext) { '.html' { 'text/html; charset=utf-8' } '.js' { 'application/javascript; charset=utf-8' } '.json' { 'application/json; charset=utf-8' } default { 'application/octet-stream' } }
    Write-Bytes $client ([IO.File]::ReadAllBytes($resolvedFile)) $type
  } else {
    Write-Text $client 'Not found' 'text/plain; charset=utf-8' '404 Not Found'
  }
}

if (Open-ExistingServerIfAvailable) { exit 0 }
$listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Parse('127.0.0.1'), $Port)
$listener.Start()
$ActualPort = $listener.LocalEndpoint.Port
Save-ServerState $ActualPort
if ($Open) { Start-Process "http://127.0.0.1:$ActualPort/" }
try {
  while ($true) {
    $client = $listener.AcceptTcpClient()
    try { Handle-Request $client (Read-HttpRequest $client) } catch { try { Write-Text $client $_.Exception.Message 'text/plain; charset=utf-8' '500 Internal Server Error' } catch {} } finally { $client.Close() }
  }
} finally {
  $listener.Stop()
}
