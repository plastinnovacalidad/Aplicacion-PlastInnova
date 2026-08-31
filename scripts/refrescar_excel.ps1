<#
================= REFRESCAR CALIDAD.XLSX, LOTES.XLSX Y PRODUCCION.XLSX =================
Automatiza Excel (via COM) para hacer lo mismo que antes se hacia a mano: abrir
el archivo, darle clic a "Datos > Actualizar todo" (dispara las consultas de
Power Query hacia los .xlsm de la NAS), guardar, y cerrar.

Por que asi y no de otra forma:
- Se decidio mantener Power Query como el mecanismo real (no leer los .xlsm
  directamente desde Node), asi que este script no reemplaza esa logica, solo
  la dispara automaticamente en vez de esperar a que alguien lo haga a mano.
- Microsoft NO da soporte oficial a automatizar Excel sin una sesion de
  Windows iniciada (no funciona bien como servicio corriendo sin usuario).
  Como la app corre en el mismo equipo donde se usa Excel, esto deberia
  funcionar en la practica, pero si el equipo se reinicia sin sesion iniciada,
  o Excel queda en un estado raro, este ciclo puede fallar. Por diseno, un
  fallo aqui NO debe tumbar nada mas: se reporta con codigo de salida distinto
  de 0 y quien lo invoque (scripts/sincronizar_produccion.js) simplemente
  reintenta en el siguiente ciclo de 6 horas.

Uso:
  powershell -NoProfile -ExecutionPolicy Bypass -File refrescar_excel.ps1 `
    -ArchivoCalidad "C:\ruta\Calidad.xlsx" -ArchivoLotes "C:\ruta\Lotes.xlsx" `
    -ArchivoProduccion "C:\ruta\Produccion.xlsx"

Salida (para que Node la pueda leer de forma simple, una linea por archivo):
  "OK: <ruta>"                  -> se refresco y se guardo sin problema
  "ERROR: <ruta> -> <mensaje>"  -> ese archivo en particular fallo
Codigo de salida: 0 si TODOS los archivos se refrescaron bien, 1 si alguno fallo.
#>

param(
  [Parameter(Mandatory = $true)]
  [string]$ArchivoCalidad,
  [Parameter(Mandatory = $true)]
  [string]$ArchivoLotes,
  [Parameter(Mandatory = $true)]
  [string]$ArchivoProduccion
)

# Tres parametros de texto simples, uno por archivo -- a proposito, en vez de
# un solo parametro [string[]] con varios valores. Se probo con
# [string[]]$Archivos (incluso con ValueFromRemainingArguments) y, invocado
# via "-File" tal como lo hace scripts/sincronizar_produccion.js, seguia
# fallando con "No se encuentra ningun parametro de posicion que acepte el
# argumento" en el segundo valor. Con parametros de un solo valor cada uno no
# hay arreglo que "juntar" -- cada uno se une a lo suyo sin ambiguedad.
$Archivos = @($ArchivoCalidad, $ArchivoLotes, $ArchivoProduccion)

$ErrorActionPreference = 'Stop'
$huboError = $false
$excel = $null

function Liberar-Com($objeto) {
  if ($objeto -ne $null) {
    [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($objeto)
  }
}

try {
  $excel = New-Object -ComObject Excel.Application
} catch {
  # Si ni siquiera se pudo abrir Excel, no tiene sentido seguir archivo por
  # archivo: se reporta error para todos y se sale.
  foreach ($ruta in $Archivos) {
    Write-Output "ERROR: $ruta -> No se pudo iniciar Excel ($($_.Exception.Message))"
  }
  exit 1
}

$excel.Visible = $false
$excel.DisplayAlerts = $false
$excel.AskToUpdateLinks = $false
# msoAutomationSecurityLow: evita que Excel muestre el dialogo de
# "Habilitar contenido" de Power Query, que en modo desatendido se quedaria
# esperando una respuesta que nunca llega.
$excel.AutomationSecurity = 1

foreach ($ruta in $Archivos) {
  $libro = $null
  try {
    if (-not (Test-Path -LiteralPath $ruta)) {
      throw "El archivo no existe en esa ruta."
    }

    $libro = $excel.Workbooks.Open($ruta, 0, $false)  # UpdateLinks=0, ReadOnly=false

    # Dispara la actualizacion de TODAS las conexiones/consultas del libro
    # (igual que "Datos > Actualizar todo").
    $libro.RefreshAll()

    # RefreshAll() no espera a que las consultas de Power Query en segundo
    # plano terminen (background=1 en xl/connections.xml) -- sin esto, el
    # Save() de abajo podria guardar el archivo a mitad de la actualizacion.
    # CalculateUntilAsyncQueriesDone() bloquea hasta que de verdad terminen.
    $excel.CalculateUntilAsyncQueriesDone()

    $libro.Save()
    $libro.Close($true)
    Liberar-Com($libro)
    $libro = $null

    Write-Output "OK: $ruta"
  } catch {
    $huboError = $true
    Write-Output "ERROR: $ruta -> $($_.Exception.Message)"
    if ($libro -ne $null) {
      try { $libro.Close($false) } catch {}
      Liberar-Com($libro)
      $libro = $null
    }
  }
}

try { $excel.Quit() } catch {}
Liberar-Com($excel)
$excel = $null

# Fuerza la liberacion de los objetos COM ahora, no cuando el recolector de
# basura de .NET decida -- si no, puede quedar un EXCEL.EXE fantasma en
# segundo plano (sin ventana, pero consumiendo memoria) hasta la proxima vez.
[System.GC]::Collect()
[System.GC]::WaitForPendingFinalizers()

if ($huboError) { exit 1 } else { exit 0 }
