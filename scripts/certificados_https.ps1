# ==========================================================================
#  Plast Innova - Certificados HTTPS de la app (crear y renovar)
#
#  Lo ejecutan crear_certificados.cmd y renovar_certificado.cmd (doble clic).
#  Debe correrse en el EQUIPO SERVIDOR (calidad-1) y con el MISMO usuario de
#  Windows que arranca la app, porque los certificados quedan en la carpeta
#  local de ese usuario:
#
#     %LOCALAPPDATA%\PlastInnova\certificados
#
#  A proposito NO quedan en la NAS (P:): ahi cualquiera con acceso a la
#  carpeta podria copiar la clave privada y hacerse pasar por el servidor.
#
#  Que crea:
#   1. La AUTORIDAD local de Plast Innova (10 anos). Se instala UNA vez en
#      cada tablet. Si ya existe, se reutiliza (nunca se reemplaza sola).
#        autoridad.pfx / autoridad_clave.txt   -> privado, no compartir
#        plast-innova-autoridad.crt            -> publico, va a las tablets
#   2. El certificado del SERVIDOR (2 anos), firmado por esa autoridad, para
#      el nombre del equipo (calidad-1), localhost y sus IPs actuales.
#        servidor.pfx / servidor_clave.txt     -> privado, lo usa la app
#        servidor.cer                          -> publico (la app lee de aqui
#                                                 la fecha de vencimiento)
#
#  Renovar = volver a emitir solo el del servidor con la misma autoridad.
#  Las tablets no se tocan. Despues hay que reiniciar la app.
#
#  No usa programas externos: solo comandos que ya trae Windows.
# ==========================================================================
param(
  [switch]$Renovar,
  [int]$AniosServidor = 2
)

$ErrorActionPreference = 'Stop'

$carpeta    = Join-Path $env:LOCALAPPDATA 'PlastInnova\certificados'
$almacen    = 'Cert:\CurrentUser\My'
$rutaCaPfx   = Join-Path $carpeta 'autoridad.pfx'
$rutaCaClave = Join-Path $carpeta 'autoridad_clave.txt'
$rutaCaCrt   = Join-Path $carpeta 'plast-innova-autoridad.crt'
$rutaSrvPfx   = Join-Path $carpeta 'servidor.pfx'
$rutaSrvClave = Join-Path $carpeta 'servidor_clave.txt'
$rutaSrvCer   = Join-Path $carpeta 'servidor.cer'

function Nueva-Clave {
  $bytes = New-Object byte[] 24
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  return [Convert]::ToBase64String($bytes)
}

function Exportar-Pfx($cert, $ruta, $clave) {
  $segura = ConvertTo-SecureString $clave -AsPlainText -Force
  # AES256_SHA256: el cifrado que entiende Node.js moderno. Las versiones
  # viejas de Windows no tienen esta opcion; ahi se usa la de por defecto.
  try {
    Export-PfxCertificate -Cert $cert -FilePath $ruta -Password $segura -CryptoAlgorithmOption AES256_SHA256 | Out-Null
  } catch [System.Management.Automation.ParameterBindingException] {
    Export-PfxCertificate -Cert $cert -FilePath $ruta -Password $segura | Out-Null
  }
}

function Quitar-DelAlmacen($cert) {
  if ($cert) {
    $ruta = Join-Path $almacen $cert.Thumbprint
    if (Test-Path $ruta) { Remove-Item -Path $ruta -DeleteKey -ErrorAction SilentlyContinue }
  }
}

Write-Host ''
Write-Host '=================================================================='
if ($Renovar) { Write-Host '  Plast Innova - Renovar certificado del servidor' }
else          { Write-Host '  Plast Innova - Crear certificados HTTPS' }
Write-Host '=================================================================='
Write-Host "  Carpeta: $carpeta"
Write-Host ''

New-Item -ItemType Directory -Force -Path $carpeta | Out-Null

$ca  = $null
$srv = $null
try {
  # ------------------------------------------------ 1. Autoridad local
  if (Test-Path $rutaCaPfx) {
    Write-Host '  Autoridad: ya existe, se reutiliza (las tablets no se tocan).'
    $claveCa = (Get-Content -Path $rutaCaClave -Raw).Trim()
    $segura  = ConvertTo-SecureString $claveCa -AsPlainText -Force
    $ca = Import-PfxCertificate -FilePath $rutaCaPfx -CertStoreLocation $almacen -Password $segura -Exportable |
          Where-Object { $_.HasPrivateKey } | Select-Object -First 1
    if (-not $ca) { throw 'No se pudo abrir la autoridad guardada (autoridad.pfx).' }
  } else {
    if ($Renovar) {
      Write-Host '  No existe la autoridad todavia. Usa crear_certificados.cmd primero.' -ForegroundColor Red
      exit 1
    }
    Write-Host '  Autoridad: creando una nueva (10 anos)...'
    $ca = New-SelfSignedCertificate `
      -Type Custom `
      -Subject 'CN=Plast Innova - Autoridad local, O=Plast-Innova S.A.' `
      -FriendlyName 'Plast Innova - Autoridad local' `
      -KeyAlgorithm RSA -KeyLength 2048 -HashAlgorithm SHA256 `
      -KeyExportPolicy Exportable `
      -KeyUsage CertSign, CRLSign, DigitalSignature `
      -TextExtension @('2.5.29.19={critical}{text}ca=1&pathlength=0') `
      -NotAfter (Get-Date).AddYears(10) `
      -CertStoreLocation $almacen
    $claveCa = Nueva-Clave
    Exportar-Pfx $ca $rutaCaPfx $claveCa
    Set-Content -Path $rutaCaClave -Value $claveCa -NoNewline -Encoding ASCII
    Export-Certificate -Cert $ca -FilePath $rutaCaCrt -Type CERT | Out-Null
  }
  if (-not (Test-Path $rutaCaCrt)) { Export-Certificate -Cert $ca -FilePath $rutaCaCrt -Type CERT | Out-Null }

  # ------------------------------------------------ 2. Certificado del servidor
  $nombre = $env:COMPUTERNAME.ToLower()
  $nombres = @($nombre, "$nombre.local", 'localhost') | Select-Object -Unique
  $ips = @('127.0.0.1')
  $ips += Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
          Where-Object { $_.IPAddress -notlike '169.254.*' -and $_.IPAddress -ne '127.0.0.1' } |
          ForEach-Object { $_.IPAddress }
  $ips = $ips | Select-Object -Unique

  $partes = @()
  $partes += $nombres | ForEach-Object { "DNS=$_" }
  $partes += $ips     | ForEach-Object { "IPAddress=$_" }
  $san = $partes -join '&'

  $vence = (Get-Date).AddYears($AniosServidor)
  if ($vence -gt $ca.NotAfter) {
    $vence = $ca.NotAfter.AddDays(-1)
    Write-Host "  OJO: la autoridad vence el $($ca.NotAfter.ToString('yyyy-MM-dd')). Pronto habra que crear una nueva e instalarla en las tablets." -ForegroundColor Yellow
  }

  Write-Host "  Servidor: emitiendo certificado hasta el $($vence.ToString('yyyy-MM-dd'))..."
  $srv = New-SelfSignedCertificate `
    -Type Custom `
    -Subject "CN=$nombre" `
    -FriendlyName 'Plast Innova - Servidor app' `
    -Signer $ca `
    -KeyAlgorithm RSA -KeyLength 2048 -HashAlgorithm SHA256 `
    -KeyExportPolicy Exportable `
    -KeyUsage DigitalSignature, KeyEncipherment `
    -TextExtension @("2.5.29.17={text}$san", '2.5.29.37={text}1.3.6.1.5.5.7.3.1') `
    -NotAfter $vence `
    -CertStoreLocation $almacen

  $claveSrv = Nueva-Clave
  Exportar-Pfx $srv $rutaSrvPfx $claveSrv
  Set-Content -Path $rutaSrvClave -Value $claveSrv -NoNewline -Encoding ASCII
  Export-Certificate -Cert $srv -FilePath $rutaSrvCer -Type CERT | Out-Null

  Write-Host ''
  Write-Host '  LISTO.' -ForegroundColor Green
  Write-Host "  Nombres: $($nombres -join ', ')"
  Write-Host "  IPs:     $($ips -join ', ')"
  Write-Host "  Vence:   $($vence.ToString('yyyy-MM-dd'))"
  Write-Host ''
  Write-Host '  Siguiente paso: reiniciar la app (cerrar la ventana de la app y'
  Write-Host '  abrir iniciar_app.cmd) para que empiece a usar el certificado.'
  if (-not $Renovar) {
    Write-Host ''
    Write-Host '  Para las tablets: abrir en cada una  http://calidad-1:3001/certificado-plast-innova.crt'
    Write-Host '  e instalarlo como "Certificado de CA".'
  }
} catch {
  Write-Host ''
  Write-Host "  ERROR: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host '  No se cambio nada en la app. Copia este mensaje y avisale a quien mantiene la app.'
  exit 1
} finally {
  # Los certificados ya quedaron guardados en archivos; no se dejan copias
  # sueltas en el almacen de certificados de Windows.
  Quitar-DelAlmacen $srv
  Quitar-DelAlmacen $ca
}
Write-Host ''
