param(
  [int]$Port = 8736
)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$chartUrl = 'https://datachart.500.com/ssq/?expect=50'
$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add("http://127.0.0.1:$Port/")
try { $listener.Start() } catch { exit 0 }
function Write-Bytes($response, [byte[]]$bytes, [string]$contentType) {
  $response.ContentType = $contentType
  $response.Headers.Add('Cache-Control', 'no-store, no-cache, must-revalidate')
  $response.ContentLength64 = $bytes.Length
  $response.OutputStream.Write($bytes, 0, $bytes.Length)
  $response.OutputStream.Close()
}
function Write-Text($response, [string]$text, [string]$contentType = 'text/plain; charset=utf-8') {
  Write-Bytes $response ([System.Text.Encoding]::UTF8.GetBytes($text)) $contentType
}
function Read-500Html {
  $response = Invoke-WebRequest -Uri $chartUrl -UseBasicParsing -TimeoutSec 30 -Headers @{ 'User-Agent' = 'Mozilla/5.0'; Referer = 'https://datachart.500.com/ssq/' }
  $memory = New-Object System.IO.MemoryStream
  $response.RawContentStream.CopyTo($memory)
  [System.Text.Encoding]::GetEncoding('gb2312').GetString($memory.ToArray())
}
function Parse-Cells([string]$html) {
  $cells = @()
  foreach ($match in [regex]::Matches($html, '<td\b([^>]*)>(.*?)</td>', 'IgnoreCase,Singleline')) {
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
    if ($red.Count -eq 6 -and $blue) {
      $rows += [ordered]@{ issue = $issue; red = @($red); blue = $blue }
    }
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
  $localPath = Join-Path $PSScriptRoot 'chart-data.js'
  if (Test-Path -LiteralPath $localPath) {
    $raw = Get-Content -LiteralPath $localPath -Raw -Encoding UTF8
    $match = [regex]::Match($raw, 'window\.SSQ_CHART_DATA\s*=\s*(\{.*\})\s*;', 'Singleline')
    if ($match.Success) {
      try {
        $local = $match.Groups[1].Value | ConvertFrom-Json
        foreach ($row in @($local.rows)) {
          $map[[string]$row.issue] = [ordered]@{ issue = [string]$row.issue; red = @($row.red | ForEach-Object { [int]$_ }); blue = [int]$row.blue }
        }
      } catch {}
    }
  }
  $localRows = @($map.Values | Sort-Object { [int]$_.issue })
  $localLatest = if ($localRows.Count) { [int]$localRows[-1].issue } else { 0 }
  $incomingRows = @($payload.chart.rows | Sort-Object { [int]$_.issue })
  if ($localRows.Count -ge 50) {
    foreach ($row in @($incomingRows | Where-Object { [int]$_.issue -gt $localLatest })) {
      $map[[string]$row.issue] = [ordered]@{ issue = [string]$row.issue; red = @($row.red | ForEach-Object { [int]$_ }); blue = [int]$row.blue }
    }
  } else {
    foreach ($row in $incomingRows) {
      $map[[string]$row.issue] = [ordered]@{ issue = [string]$row.issue; red = @($row.red | ForEach-Object { [int]$_ }); blue = [int]$row.blue }
    }
  }
  $rows = @($map.Values | Sort-Object { [int]$_.issue } | Select-Object -Last 50)
  $payload.chart.rows = $rows
  $latest = $rows[-1]
  $payload.latest = [ordered]@{
    issue = '20' + $latest.issue
    date = ''
    red = @($latest.red | ForEach-Object { '{0:D2}' -f $_ })
    blue = @('{0:D2}' -f $latest.blue)
    source = '500彩票网'
    updatedAt = $payload.chart.generatedAt
  }
  $payload
}
function Save-DataFiles($payload) {
  'window.SSQ_CHART_DATA = ' + (($payload.chart) | ConvertTo-Json -Depth 8 -Compress) + ';' | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'chart-data.js') -Encoding UTF8
  'window.SSQ_LATEST = ' + (($payload.latest) | ConvertTo-Json -Depth 8 -Compress) + ';' | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'latest-ssq.js') -Encoding UTF8
}
while ($listener.IsListening) {
  try {
    $context = $listener.GetContext()
    $requestPath = [uri]::UnescapeDataString($context.Request.Url.AbsolutePath.TrimStart('/'))
    if ([string]::IsNullOrWhiteSpace($requestPath)) { $requestPath = 'ssq-analysis.html' }
    if ($requestPath -eq 'api/refresh') {
      $payload = Merge-WithLocalHistory (Get-500Payload)
      Save-DataFiles $payload
      Write-Text $context.Response ($payload | ConvertTo-Json -Depth 8 -Compress) 'application/json; charset=utf-8'
      continue
    }
    $fullPath = Join-Path $PSScriptRoot $requestPath
    $resolvedRoot = (Resolve-Path -LiteralPath $PSScriptRoot).Path
    if ((Test-Path -LiteralPath $fullPath -PathType Leaf) -and ((Resolve-Path -LiteralPath $fullPath).Path.StartsWith($resolvedRoot))) {
      $ext = [IO.Path]::GetExtension($fullPath).ToLowerInvariant()
      $type = switch ($ext) { '.html' { 'text/html; charset=utf-8' } '.js' { 'application/javascript; charset=utf-8' } '.json' { 'application/json; charset=utf-8' } default { 'application/octet-stream' } }
      Write-Bytes $context.Response ([IO.File]::ReadAllBytes($fullPath)) $type
    } else {
      $context.Response.StatusCode = 404
      Write-Text $context.Response 'Not found'
    }
  } catch {
    try { $context.Response.StatusCode = 500; Write-Text $context.Response $_.Exception.Message } catch {}
  }
}