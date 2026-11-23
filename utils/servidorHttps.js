// ======================== SERVIDOR HTTPS ========================
// Pedido por Julio (23/11/2026): que las tablets puedan guardar una copia de
// Caja roja para abrirla sin señal. Chrome solo permite eso (service worker)
// en sitios seguros (https://), así que la app pasa a responder con HTTPS.
//
// Cómo funciona:
// - Los certificados los crea crear_certificados.cmd en la carpeta LOCAL del
//   usuario de Windows del servidor (%LOCALAPPDATA%\PlastInnova\certificados),
//   nunca en la NAS, para que nadie pueda copiar la clave privada.
// - Si esos archivos NO existen (o HTTPS_DESACTIVADO=1 en el .env, o el
//   certificado no se puede leer), la app arranca en http:// exactamente
//   como siempre. Así, este cambio nunca deja la app sin arrancar.
// - Si existen, el MISMO puerto (3001) atiende las dos cosas:
//     · https://calidad-1:3001  -> la app normal.
//     · http://calidad-1:3001   -> redirige sola a https:// (para que los
//       accesos directos viejos de las tablets sigan sirviendo). Las
//       llamadas /api/... por http se siguen atendiendo, para que una página
//       que quedó abierta con la dirección vieja pueda terminar de enviar lo
//       que tenía pendiente (Caja roja guarda en la tablet por dirección).
//   Se distingue mirando el primer byte que manda el navegador: una conexión
//   HTTPS siempre empieza con el byte 0x16 (saludo TLS).
// - /certificado-plast-innova.crt descarga la autoridad de Plast Innova (es
//   pública) para instalarla en las tablets; funciona por http y por https.
// - Avisa en consola (y por WhatsApp, si se le pasa cómo) cuando faltan 30
//   días o menos para que venza el certificado del servidor.
// ================================================================

const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const http = require('http');
const https = require('https');
const crypto = require('crypto');

const CARPETA_CERTIFICADOS = path.join(
  process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
  'PlastInnova', 'certificados'
);
const RUTA_PFX = path.join(CARPETA_CERTIFICADOS, 'servidor.pfx');
const RUTA_CLAVE = path.join(CARPETA_CERTIFICADOS, 'servidor_clave.txt');
const RUTA_CER = path.join(CARPETA_CERTIFICADOS, 'servidor.cer');
const RUTA_AUTORIDAD = path.join(CARPETA_CERTIFICADOS, 'plast-innova-autoridad.crt');

const URL_DESCARGA_AUTORIDAD = '/certificado-plast-innova.crt';
const DIAS_AVISO_VENCIMIENTO = 30;

function servirAutoridad(req, res) {
  fs.readFile(RUTA_AUTORIDAD, (err, contenido) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('El certificado todavía no se ha creado en el servidor (crear_certificados.cmd).');
    }
    res.writeHead(200, {
      'Content-Type': 'application/x-x509-ca-cert',
      'Content-Disposition': 'attachment; filename="plast-innova-autoridad.crt"',
      'Cache-Control': 'no-store',
    });
    res.end(contenido);
  });
}

// Devuelve { pfx, passphrase } o null (con el motivo en consola) si no se
// debe/puede usar HTTPS.
function cargarCertificado() {
  if (process.env.HTTPS_DESACTIVADO === '1') {
    console.log('🔓 HTTPS desactivado (HTTPS_DESACTIVADO=1 en el .env). La app queda en http:// como antes.');
    return null;
  }
  if (!fs.existsSync(RUTA_PFX) || !fs.existsSync(RUTA_CLAVE)) {
    console.log(`🔓 Sin certificado HTTPS en ${CARPETA_CERTIFICADOS}. La app queda en http:// como antes (para activarlo: crear_certificados.cmd).`);
    return null;
  }
  try {
    return {
      pfx: fs.readFileSync(RUTA_PFX),
      passphrase: fs.readFileSync(RUTA_CLAVE, 'utf8').trim(),
    };
  } catch (e) {
    console.error('⚠️ No se pudo leer el certificado HTTPS; la app queda en http://:', e.message);
    return null;
  }
}

function leerVencimiento() {
  try {
    return new Date(new crypto.X509Certificate(fs.readFileSync(RUTA_CER)).validTo);
  } catch (e) {
    return null;
  }
}

// Arranca la app en `puerto`. Llama a alIniciar('https' | 'http') cuando ya
// está escuchando. Si algo del HTTPS falla, cae a http:// como siempre.
function iniciarServidor(app, puerto, alIniciar) {
  // La descarga de la autoridad va también dentro de la app, para que
  // funcione en modo http (antes de activar HTTPS: así se instala en las
  // tablets primero) y por https.
  app.get(URL_DESCARGA_AUTORIDAD, servirAutoridad);

  const arrancarHttp = () => app.listen(puerto, () => alIniciar('http'));

  const cert = cargarCertificado();
  if (!cert) return arrancarHttp();

  let servidorHttps;
  try {
    servidorHttps = https.createServer({ pfx: cert.pfx, passphrase: cert.passphrase }, app);
  } catch (e) {
    console.error('⚠️ El certificado HTTPS no es válido o la clave no coincide; la app queda en http://:', e.message);
    return arrancarHttp();
  }

  const servidorHttp = http.createServer((req, res) => {
    const url = req.url || '/';
    if (url.split('?')[0] === URL_DESCARGA_AUTORIDAD) return servirAutoridad(req, res);
    if (url.startsWith('/api/')) return app(req, res);
    // Solo se deja pasar lo que puede tener un nombre de equipo/IP y puerto.
    const host = String(req.headers.host || `localhost:${puerto}`).replace(/[^A-Za-z0-9.\-:\[\]]/g, '');
    // 302 (temporal) y no 301: un 301 queda guardado en el navegador para
    // siempre, y si algún día hay que volver a http:// (HTTPS_DESACTIVADO=1)
    // las tablets quedarían redirigiendo a una dirección que ya no responde.
    res.writeHead(302, { Location: `https://${host}${url}`, 'Cache-Control': 'no-store' });
    res.end();
  });

  const servidor = net.createServer((socket) => {
    socket.on('error', () => { /* conexión cortada por la tablet; nada que hacer */ });
    socket.setTimeout(30000, () => socket.destroy()); // conexión abierta que nunca manda nada
    socket.once('data', (primerTrozo) => {
      socket.setTimeout(0); // de aquí en adelante, los tiempos los maneja cada servidor
      socket.pause();
      socket.unshift(primerTrozo);
      const destino = primerTrozo[0] === 0x16 ? servidorHttps : servidorHttp;
      destino.emit('connection', socket);
      process.nextTick(() => socket.resume());
    });
  });

  servidor.listen(puerto, () => alIniciar('https'));
  return servidor;
}

// Revisa una vez al día cuántos días le quedan al certificado del servidor.
// `avisar(mensaje)` es opcional (por ejemplo, alerta de WhatsApp al admin).
function vigilarVencimiento(avisar) {
  const revisar = () => {
    const vence = leerVencimiento();
    if (!vence) return;
    const dias = Math.floor((vence.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
    if (dias > DIAS_AVISO_VENCIMIENTO) return;
    const fecha = vence.toLocaleDateString('es-CO');
    const mensaje = dias < 0
      ? `🔒 El certificado HTTPS de la app VENCIÓ el ${fecha}. Las tablets van a mostrar "conexión no privada". Ejecuta renovar_certificado.cmd en el servidor y reinicia la app.`
      : `🔒 El certificado HTTPS de la app vence el ${fecha} (en ${dias} día(s)). Ejecuta renovar_certificado.cmd en el servidor y reinicia la app.`;
    console.warn('\n⚠️ ' + mensaje + '\n');
    if (avisar) {
      try { avisar(mensaje); } catch (e) { /* el aviso por WhatsApp nunca debe tumbar el servidor */ }
    }
  };
  // Primera revisión a los 5 minutos (para que WhatsApp ya esté conectado)
  // y luego una vez al día.
  setTimeout(revisar, 5 * 60 * 1000);
  setInterval(revisar, 24 * 60 * 60 * 1000);
}

module.exports = {
  iniciarServidor,
  vigilarVencimiento,
  leerVencimiento,
  CARPETA_CERTIFICADOS,
  URL_DESCARGA_AUTORIDAD,
};
