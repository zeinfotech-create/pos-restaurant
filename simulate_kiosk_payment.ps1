$hubIp = "localhost" # Change this to your Server IP if running from another PC
$port = 3030
$url = "http://$($hubIp):$($port)/api/debug/simulate-payment"

$kioskId = Read-Host "Enter Kiosk Device ID (1, 2, or 3)"
$amount = Read-Host "Enter Test Amount (e.g. 1.00)"

$body = @{
    kioskId = $kioskId
    amount = $amount
} | ConvertTo-Json

Write-Host "Sending simulated payment for Kiosk $kioskId to: $url" -ForegroundColor Cyan
try {
    $response = Invoke-RestMethod -Uri $url -Method Post -Body $body -ContentType "application/json"
    Write-Host "✅ Success! Server says: $($response.message)" -ForegroundColor Green
} catch {
    Write-Host "❌ Failed! Error: $($_.Exception.Message)" -ForegroundColor Red
}
pause
