const fs = require('fs');
const FileType = require('file-type');

// El navegador manda un "mimetype" en el formulario, pero cualquiera puede
// cambiarlo antes de subir el archivo (por ejemplo, renombrar un .html a
// .jpg). Esta lista es la misma que ya usa utils/upload.js como primer
// filtro; aquí se vuelve a comprobar, pero mirando el contenido real del
// archivo (los primeros bytes, la "firma" del formato) en vez de confiar en
// lo que dijo el navegador.
const MIMES_PERMITIDOS = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp', 'application/pdf'];

// Devuelve true si el contenido real del archivo en `filePath` es alguno de
// los formatos permitidos. Si el archivo es demasiado pequeño para
// detectarlo, o no coincide con ningún formato conocido, devuelve false —
// en ambos casos es más seguro rechazarlo que aceptarlo a ciegas.
async function contenidoRealValido(filePath) {
  try {
    const tipo = await FileType.fromFile(filePath);
    return !!tipo && MIMES_PERMITIDOS.includes(tipo.mime);
  } catch (e) {
    return false;
  }
}

// Valida un archivo ya guardado por multer y, si no pasa la validación, lo
// borra del disco y responde con el error. Devuelve true si el archivo es
// válido (y por lo tanto la ruta puede seguir usándolo), o false si ya
// respondió con el error y borró el archivo (la ruta debe detenerse ahí).
async function validarOBorrar(req, res, filePath) {
  const valido = await contenidoRealValido(filePath);
  if (!valido) {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    res.status(400).json({ error: 'El archivo no es una imagen o PDF válido (el contenido no coincide con el tipo esperado, aunque el nombre o la extensión digan lo contrario)' });
    return false;
  }
  return true;
}

module.exports = { contenidoRealValido, validarOBorrar, MIMES_PERMITIDOS };
