param([int]$Port = 3000)
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Prefixes.Add("http://127.0.0.1:$Port/")
try { $listener.Start() } catch {
    $Port = 8080
    $listener = New-Object System.Net.HttpListener
    $listener.Prefixes.Add("http://localhost:$Port/")
    $listener.Start()
}
Write-Host "Server started at http://localhost:$Port"
$mimeTypes = @{".html"="text/html; charset=utf-8";".css"="text/css";".js"="application/javascript";".json"="application/json";".png"="image/png";".jpg"="image/jpeg";".jpeg"="image/jpeg";".gif"="image/gif";".svg"="image/svg+xml";".ico"="image/x-icon";".xml"="application/xml";".txt"="text/plain";".woff"="font/woff";".woff2"="font/woff2"}
$root = $PSScriptRoot
while ($listener.IsListening) {
    try {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response
        $rawUrl = $request.Url.LocalPath
        if ($rawUrl -eq "/" -or $rawUrl -eq "") { $rawUrl = "/index.html" }
        $filePath = Join-Path $root ($rawUrl.TrimStart('/'))
        if ((Test-Path $filePath -PathType Container)) { $filePath = Join-Path $filePath "index.html" }
        if (Test-Path $filePath -PathType Leaf) {
            $ext = [System.IO.Path]::GetExtension($filePath).ToLower()
            $ct = if ($mimeTypes.ContainsKey($ext)) { $mimeTypes[$ext] } else { "application/octet-stream" }
            $response.ContentType = $ct
            $bytes = [System.IO.File]::ReadAllBytes($filePath)
            $response.ContentLength64 = $bytes.Length
            $response.StatusCode = 200
            $response.OutputStream.Write($bytes, 0, $bytes.Length)
        } else {
            $response.StatusCode = 404
            $err = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found")
            $response.ContentLength64 = $err.Length
            $response.OutputStream.Write($err, 0, $err.Length)
        }
        $response.OutputStream.Close()
    } catch {}
}
