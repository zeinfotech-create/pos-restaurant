$hubIp = "localhost" # Change this to your Server IP if running from another PC
$port = 3030
$url = "http://$($hubIp):$($port)/api/webhooks/upi-notification"

$body = @{
    title = "Test Connection"
    text = "Checking connection from PowerShell..."
    licenseKey = "GLOBAL"
} | ConvertTo-Json

Write-Host "Testing connection to: $url" -ForegroundColor Cyan
try {
    $response = Invoke-RestMethod -Uri $url -Method Post -Body $body -ContentType "application/json"
    Write-Host "✅ Success! Server responded: $($response | ConvertTo-Json -Compress)" -ForegroundColor Green
} catch {
    Write-Host "❌ Failed! Error: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.Exception.Response) {
        Write-Host "Response Code: $($_.Exception.Response.StatusCode)" -ForegroundColor Yellow
    }
}
pause
