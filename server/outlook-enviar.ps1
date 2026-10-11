# Envia UN correo a traves de Outlook clasico (COM). Uso interno de server/correo-outlook.js.
# Recibe la ruta de un JSON {to, subject, html, cuenta}; nunca datos en la linea de comandos.
param([Parameter(Mandatory = $true)][string]$Payload)
$ErrorActionPreference = 'Stop'
try {
  $datos = Get-Content -LiteralPath $Payload -Raw -Encoding UTF8 | ConvertFrom-Json
  $ol = New-Object -ComObject Outlook.Application
  $mail = $ol.CreateItem(0)  # olMailItem
  $mail.To = [string]$datos.to
  $mail.Subject = [string]$datos.subject
  $mail.HTMLBody = [string]$datos.html
  if ($datos.cuenta) {
    $cuenta = $null
    foreach ($a in $ol.Session.Accounts) {
      if ([string]::Equals([string]$a.SmtpAddress, [string]$datos.cuenta, [StringComparison]::OrdinalIgnoreCase)) { $cuenta = $a; break }
    }
    if (-not $cuenta) { throw "La cuenta $($datos.cuenta) no existe en el perfil de Outlook." }
    $mail.SendUsingAccount = $cuenta
  }
  $mail.Send()
  exit 0
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}
