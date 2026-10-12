# Lee respuestas de la bandeja de entrada de la cuenta de la agenda (Outlook clasico, COM).
# Uso interno de server/correo-entrada.js. Recibe SOLO rutas de JSON; nunca datos en la linea de comandos.
#   -Payload <ruta>  {cuenta, dias, excluir}  -> imprime JSON [{entryId, from, subject, body, received}]
#   -Marcar  <ruta>  {cuenta, items:[{entryId, categoria}]} -> agrega la categoria (conserva las existentes) y guarda.
# Nunca mueve, borra ni responde correos.
param([string]$Payload, [string]$Marcar)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Get-Almacen($ol, [string]$cuenta) {
  if (-not $cuenta) { throw 'Falta la cuenta de Outlook a leer.' }
  foreach ($a in $ol.Session.Accounts) {
    if ([string]::Equals([string]$a.SmtpAddress, $cuenta, [StringComparison]::OrdinalIgnoreCase)) { return $a.DeliveryStore }
  }
  throw "La cuenta $cuenta no existe en el perfil de Outlook."
}

function Get-Remitente($m) {
  try {
    if ([string]$m.SenderEmailType -eq 'EX') {
      $u = $m.Sender.GetExchangeUser()
      if ($u) { return [string]$u.PrimarySmtpAddress }
    }
  } catch { }
  return [string]$m.SenderEmailAddress
}

function Tiene-Categoria([string]$actuales, [string]$cat) {
  if (-not $actuales) { return $false }
  foreach ($c in $actuales.Split(',')) { if ($c.Trim() -ieq $cat) { return $true } }
  return $false
}

try {
  $ol = New-Object -ComObject Outlook.Application
  if ($Marcar) {
    $datos = Get-Content -LiteralPath $Marcar -Raw -Encoding UTF8 | ConvertFrom-Json
    $store = Get-Almacen $ol ([string]$datos.cuenta)
    foreach ($it in @($datos.items)) {
      $m = $ol.Session.GetItemFromID([string]$it.entryId, $store.StoreID)
      $cat = [string]$it.categoria
      if (-not (Tiene-Categoria ([string]$m.Categories) $cat)) {
        if ([string]$m.Categories) { $m.Categories = ([string]$m.Categories) + ', ' + $cat } else { $m.Categories = $cat }
        $m.Save()
      }
    }
    exit 0
  }
  if (-not $Payload) { throw 'Falta -Payload o -Marcar.' }
  $datos = Get-Content -LiteralPath $Payload -Raw -Encoding UTF8 | ConvertFrom-Json
  $store = Get-Almacen $ol ([string]$datos.cuenta)
  $inbox = $store.GetDefaultFolder(6)  # olFolderInbox
  $desde = (Get-Date).AddDays(-[int]$datos.dias)
  $excluir = [string]$datos.excluir
  $items = $inbox.Items
  $items.Sort('[ReceivedTime]', $true)
  $out = New-Object System.Collections.ArrayList
  foreach ($m in $items) {
    if ($m.Class -ne 43) { continue }  # olMail
    if ($m.ReceivedTime -lt $desde) { break }
    if (Tiene-Categoria ([string]$m.Categories) $excluir) { continue }
    $body = [string]$m.Body
    if ($body.Length -gt 2000) { $body = $body.Substring(0, 2000) }
    [void]$out.Add([pscustomobject]@{
      entryId  = [string]$m.EntryID
      from     = Get-Remitente $m
      subject  = [string]$m.Subject
      body     = $body
      received = ([datetime]$m.ReceivedTime).ToString('s')
    })
  }
  if ($out.Count -eq 0) { [Console]::Out.Write('[]') }
  else { [Console]::Out.Write((ConvertTo-Json -InputObject @($out) -Depth 3 -Compress)) }
  exit 0
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}
